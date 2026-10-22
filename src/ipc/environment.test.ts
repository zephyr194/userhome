import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  DEFAULT_ENV_PATTERNS,
  decodeEnvEditPreview,
  decodeEnvFileOutcome,
  decodeRevealedValue,
  decodeScanOutcome,
  editsProblem,
  executeEnvironmentEdit,
  isSafeRelativePath,
  previewEnvironmentCreate,
  previewEnvironmentEdit,
  readEnvironmentFile,
  revealEnvironmentValue,
  scanEnvironmentFiles,
  type EnvKeyEdit,
} from "./environment";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const SETTINGS = { patterns: DEFAULT_ENV_PATTERNS, recursive: false };

function wireScan(overrides: Record<string, unknown> = {}) {
  return {
    root: "~/proj",
    recursive: false,
    patterns: [".env", ".env.*", "*.env"],
    files: [
      {
        relativePath: ".env",
        name: ".env",
        kind: "ENVIRONMENT",
        sizeBytes: 12,
        oversized: false,
        symlink: false,
      },
      {
        relativePath: "sub/.env.example",
        name: ".env.example",
        kind: "TEMPLATE",
        sizeBytes: 4,
        oversized: false,
        symlink: true,
      },
    ],
    skipped: [
      { relativePath: ".env.link", reason: "OUTSIDE_LINK" },
      { relativePath: null, reason: "INVALID_NAME" },
    ],
    skippedTotal: 2,
    excludedDirectories: 1,
    partialReasons: ["DEPTH_LIMIT"],
    entriesExamined: 7,
    limits: {
      maxDepth: 5,
      maxEntries: 2000,
      maxMatches: 200,
      maxFileBytes: 1048576,
    },
    exclusions: [".git", "node_modules"],
    ...overrides,
  };
}

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ENTRY",
    line: 2,
    endLine: 2,
    key: "PORT",
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 4,
    value: "3000",
    quote: "NONE",
    flags: [],
    ...overrides,
  };
}

function wireFile(rows: unknown[] = [entryRow()], overrides = {}) {
  return {
    status: "READY",
    relativePath: ".env",
    kind: "ENVIRONMENT",
    contentHash: "a".repeat(64),
    sizeBytes: 30,
    lineCount: 3,
    rows,
    rowsTruncated: false,
    entryCount: 1,
    secretCount: 0,
    flaggedCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  clearMocks();
});

describe("environment IPC", () => {
  it("scans with an authorization id and settings, never a path", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("scan_environment_files");
      expect(payload).toEqual({
        input: {
          grantId: GRANT_ID,
          patterns: [".env", ".env.*", "*.env"],
          recursive: false,
        },
      });
      return wireScan();
    });

    const outcome = await scanEnvironmentFiles(GRANT_ID, SETTINGS);

    expect(outcome.files.map((file) => file.relativePath)).toEqual([
      ".env",
      "sub/.env.example",
    ]);
    expect(outcome.skipped[1]).toEqual({ reason: "INVALID_NAME" });
    expect(outcome.partialReasons).toEqual(["DEPTH_LIMIT"]);
  });

  it("reads one file and decodes the row model", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_environment_file");
      expect(payload).toEqual({
        input: {
          grantId: GRANT_ID,
          relativePath: "sub/.env",
          patterns: [".env", ".env.*", "*.env"],
          recursive: true,
        },
      });
      return wireFile([
        { kind: "BLANK", line: 1 },
        entryRow({ flags: ["DUPLICATE_KEY"] }),
        { kind: "COMMENT", line: 3, text: "# note", withheld: false },
        { kind: "UNKNOWN", line: 4, text: null, withheld: true },
      ]);
    });

    const outcome = await readEnvironmentFile(GRANT_ID, "sub/.env", {
      ...SETTINGS,
      recursive: true,
    });

    expect(outcome.status).toBe("READY");
    if (outcome.status !== "READY") return;
    expect(outcome.file.rows.map((row) => row.kind)).toEqual([
      "BLANK",
      "ENTRY",
      "COMMENT",
      "UNKNOWN",
    ]);
    expect(outcome.file.rows[3]).toEqual({
      kind: "UNKNOWN",
      line: 4,
      withheld: true,
    });
  });

  it("decodes each read failure kind without turning it into an empty file", () => {
    for (const reason of [
      "NOT_FOUND",
      "PERMISSION_DENIED",
      "MALFORMED",
      "TOO_LARGE",
      "UNSUPPORTED",
      "EXCLUDED",
      "IO",
    ]) {
      expect(
        decodeEnvFileOutcome({ status: "UNAVAILABLE", reason, message: "原因" }),
      ).toEqual({ status: "UNAVAILABLE", reason, message: "原因" });
    }
  });

  it("reveals a value with only references to it", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("reveal_environment_value");
      expect(payload).toEqual({
        input: {
          grantId: GRANT_ID,
          relativePath: ".env",
          patterns: [".env", ".env.*", "*.env"],
          recursive: false,
          line: 3,
          key: "API_TOKEN",
        },
      });
      return { value: "tok-123" };
    });

    await expect(
      revealEnvironmentValue(GRANT_ID, ".env", SETTINGS, {
        line: 3,
        key: "API_TOKEN",
      }),
    ).resolves.toBe("tok-123");
  });

  it("refuses bad references before calling the backend", async () => {
    mockIPC(() => {
      throw new Error("must not be called");
    });
    const rejected = { code: "INVALID_INPUT" };

    await expect(scanEnvironmentFiles("../x", SETTINGS)).rejects.toMatchObject(rejected);
    for (const path of ["/etc/passwd", "../.env", "a/../.env", "a//b", "a\\b", "", "a\n"]) {
      await expect(
        readEnvironmentFile(GRANT_ID, path, SETTINGS),
      ).rejects.toMatchObject(rejected);
    }
    for (const target of [
      { line: 0, key: "A" },
      { line: 1.5, key: "A" },
      { line: 1, key: "1BAD" },
      { line: 1, key: "A;rm" },
    ]) {
      await expect(
        revealEnvironmentValue(GRANT_ID, ".env", SETTINGS, target),
      ).rejects.toMatchObject(rejected);
    }
  });

  it("accepts only relative paths without dot segments", () => {
    expect(isSafeRelativePath(".env")).toBe(true);
    expect(isSafeRelativePath("a/b/.env.local")).toBe(true);
    for (const path of ["", "/a", "a/", "./a", "a/./b", "../a", "a\\b", "a\u0000b"]) {
      expect(isSafeRelativePath(path)).toBe(false);
    }
  });
});

describe("environment payload decoding", () => {
  it("decodes the scan payload", () => {
    expect(decodeScanOutcome(wireScan()).limits.maxMatches).toBe(200);
  });

  it.each([
    ["a non-object payload", "files"],
    ["a file path that is absolute", wireScan({ files: [{ ...wireScan().files[0], relativePath: "/etc/.env", name: ".env" }] })],
    ["a file path that traverses", wireScan({ files: [{ ...wireScan().files[0], relativePath: "../.env" }] })],
    ["a name that differs from the path", wireScan({ files: [{ ...wireScan().files[0], name: "other" }] })],
    ["an unknown file kind", wireScan({ files: [{ ...wireScan().files[0], kind: "SECRET" }] })],
    ["a negative size", wireScan({ files: [{ ...wireScan().files[0], sizeBytes: -1 }] })],
    ["a fractional size", wireScan({ files: [{ ...wireScan().files[0], sizeBytes: 1.5 }] })],
    ["more files than the contract allows", wireScan({ files: Array.from({ length: 201 }, () => wireScan().files[0]) })],
    ["an unknown partial reason", wireScan({ partialReasons: ["EVERYTHING"] })],
    ["duplicate partial reasons", wireScan({ partialReasons: ["DEPTH_LIMIT", "DEPTH_LIMIT"] })],
    ["an unknown skip reason", wireScan({ skipped: [{ relativePath: "a", reason: "NOPE" }] })],
    ["a root with control characters", wireScan({ root: "~/a\nb" })],
    ["an empty root", wireScan({ root: "" })],
    ["missing limits", wireScan({ limits: null })],
    ["too many patterns", wireScan({ patterns: Array.from({ length: 17 }, () => "a") })],
  ])("rejects %s", (_label, payload) => {
    expect(() => decodeScanOutcome(payload)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it.each([
    ["a secret that carries its value", entryRow({ secret: true })],
    ["a value that disagrees with its length", entryRow({ valueLength: 9 })],
    ["has-value disagreeing with the length", entryRow({ hasValue: false })],
    ["an invalid key", entryRow({ key: "A B" })],
    ["an end line before the start", entryRow({ endLine: 1 })],
    ["a zero line number", entryRow({ line: 0, endLine: 0 })],
    ["unknown flags", entryRow({ flags: ["EXECUTE"] })],
    ["duplicate flags", entryRow({ flags: ["INTERPOLATION", "INTERPOLATION"] })],
    ["an unknown quote style", entryRow({ quote: "BACKTICK" })],
    ["a withheld comment that still has text", { kind: "COMMENT", line: 1, text: "# x", withheld: true }],
    ["a comment without text and not withheld", { kind: "COMMENT", line: 1, text: null, withheld: false }],
    ["an unknown row kind", { kind: "SCRIPT", line: 1 }],
    ["a row that is not an object", "ENTRY"],
  ])("rejects a file with %s", (_label, row) => {
    expect(() => decodeEnvFileOutcome(wireFile([row]))).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it.each([
    ["a bad content hash", wireFile([], { contentHash: "xyz" })],
    ["an absolute file path", wireFile([], { relativePath: "/etc/hosts" })],
    ["too many rows", wireFile(Array.from({ length: 5001 }, (_, index) => ({ kind: "BLANK", line: index + 1 })))],
    ["an unknown status", { status: "PENDING" }],
    ["an unavailable result without a known reason", { status: "UNAVAILABLE", reason: "WEIRD", message: "x" }],
    ["an unavailable result without a message", { status: "UNAVAILABLE", reason: "IO", message: "" }],
  ])("rejects %s", (_label, payload) => {
    expect(() => decodeEnvFileOutcome(payload)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it("counts value length in characters, not UTF-16 units", () => {
    const outcome = decodeEnvFileOutcome(
      wireFile([entryRow({ value: "a😀", valueLength: 2 })]),
    );
    expect(outcome.status).toBe("READY");
  });

  it("accepts a secret row that withholds its value", () => {
    const outcome = decodeEnvFileOutcome(
      wireFile([entryRow({ secret: true, value: null, valueLength: 14 })]),
    );
    if (outcome.status !== "READY") throw new Error("expected a file");
    expect(outcome.file.rows[0]).not.toHaveProperty("value");
  });

  it.each([
    ["extra fields", { value: "x", token: "y" }],
    ["a non-string value", { value: 1 }],
    ["no value", {}],
    ["a null payload", null],
  ])("rejects a reveal payload with %s", (_label, payload) => {
    expect(() => decodeRevealedValue(payload)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it("does not echo payload content in decode errors", () => {
    try {
      decodeEnvFileOutcome(wireFile([entryRow({ secret: true, value: "hunter2" })]));
      throw new Error("expected a failure");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("hunter2");
    }
  });
});

// ---- saving edits ------------------------------------------------------------

const HASH = "b".repeat(64);
const SECRET_TEXT = "hunter2-very-secret";

function wireChange(overrides: Record<string, unknown> = {}) {
  return {
    key: "PORT",
    change: "MODIFY",
    secret: false,
    before: "80",
    after: "8080",
    omitted: false,
    ...overrides,
  };
}

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: "Replace ~/proj/.env.",
    effects: ["Target: ~/proj/.env"],
    expiresAt: "2026-10-16T10:05:00Z",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: "~/proj/.env",
    currentHash: HASH,
    proposedHash: "c".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    changes: [wireChange()],
    fileKind: "ENVIRONMENT",
    matchesDefaultPatterns: true,
    ...overrides,
  };
}

const EDITS: EnvKeyEdit[] = [
  { op: "SET", key: "PORT", value: "8080" },
  { op: "ADD", key: "REGION", value: "eu", exported: true },
  { op: "REMOVE", key: "OLD" },
];

describe("environment save IPC", () => {
  it("previews edits of a file with references and the hash it showed", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_environment_edit");
      expect(payload).toEqual({
        input: {
          grantId: GRANT_ID,
          relativePath: "sub/.env",
          patterns: [".env", ".env.*", "*.env"],
          recursive: true,
          expectedHash: HASH,
          edits: [
            { op: "SET", key: "PORT", value: "8080" },
            { op: "ADD", key: "REGION", value: "eu", exported: true },
            { op: "REMOVE", key: "OLD" },
          ],
        },
      });
      return wirePreview();
    });

    const preview = await previewEnvironmentEdit(
      GRANT_ID,
      "sub/.env",
      { ...SETTINGS, recursive: true },
      HASH,
      EDITS,
    );

    expect(preview.operationId).toBe("op-1");
    expect(preview.kind).toBe("REPLACE");
    expect(preview.changes[0]).toEqual(wireChange());
    expect(preview.fileKind).toBe("ENVIRONMENT");
  });

  it("previews a new file through its save-location authorization only", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_environment_create");
      expect(payload).toEqual({
        input: { grantId: GRANT_ID, edits: [{ op: "ADD", key: "A", value: "1" }] },
      });
      return wirePreview({
        kind: "CREATE",
        recoveryPoint: "NONE_CREATED",
        currentHash: undefined,
        changes: [wireChange({ key: "A", change: "ADD", before: undefined, after: "1" })],
      });
    });

    const preview = await previewEnvironmentCreate(GRANT_ID, [
      { op: "ADD", key: "A", value: "1" },
    ]);

    expect(preview.kind).toBe("CREATE");
    expect(preview.recoveryPoint).toBe("NONE_CREATED");
  });

  it("confirms with ids only and decodes the transaction outcome", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_environment_edit");
      expect(payload).toEqual({
        input: { operationId: "op-1", grantId: GRANT_ID, relativePath: ".env" },
      });
      return {
        operationId: "op-1",
        summary: "Replace ~/proj/.env.",
        effects: [],
        expiresAt: "2026-10-16T10:05:00Z",
        status: "SUCCEEDED",
        events: [],
        outcome: {
          kind: "REPLACE",
          status: "SUCCEEDED",
          fileState: "WRITTEN",
          recoveryPoint: "BACKUP",
          backupId: "b-1",
          summary: "The file was written and verified.",
        },
      };
    });

    const execution = await executeEnvironmentEdit({
      operationId: "op-1",
      grantId: GRANT_ID,
      relativePath: ".env",
    });

    expect(execution.outcome.fileState).toBe("WRITTEN");
    expect(execution.outcome.backupId).toBe("b-1");
  });

  it("omits the path when confirming a new file", async () => {
    let sent: unknown;
    mockIPC((_command, payload) => {
      sent = payload;
      return { status: "not an execution" };
    });
    await executeEnvironmentEdit({ operationId: "op-1", grantId: GRANT_ID }).catch(
      () => undefined,
    );
    expect(sent).toEqual({ input: { operationId: "op-1", grantId: GRANT_ID } });
  });

  it("rejects bad input before any IPC call", async () => {
    let calls = 0;
    mockIPC(() => {
      calls += 1;
      return {};
    });
    const rejected = (promise: Promise<unknown>) =>
      expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await rejected(previewEnvironmentEdit("not-an-id", ".env", SETTINGS, HASH, EDITS));
    await rejected(previewEnvironmentEdit(GRANT_ID, "/etc/.env", SETTINGS, HASH, EDITS));
    await rejected(previewEnvironmentEdit(GRANT_ID, "../.env", SETTINGS, HASH, EDITS));
    await rejected(previewEnvironmentEdit(GRANT_ID, ".env", SETTINGS, "xyz", EDITS));
    await rejected(previewEnvironmentEdit(GRANT_ID, ".env", SETTINGS, HASH, []));
    await rejected(previewEnvironmentCreate("x", EDITS));
    await rejected(
      previewEnvironmentCreate(GRANT_ID, [{ op: "ADD", key: "BAD KEY", value: "1" }]),
    );
    await rejected(executeEnvironmentEdit({ operationId: "", grantId: GRANT_ID }));
    await rejected(executeEnvironmentEdit({ operationId: "op", grantId: "x" }));
    await rejected(
      executeEnvironmentEdit({ operationId: "op", grantId: GRANT_ID, relativePath: "/abs" }),
    );
    expect(calls).toBe(0);
  });

  it.each([
    ["no edits", [] as EnvKeyEdit[]],
    ["too many edits", Array.from({ length: 65 }, (_, index) => ({ op: "REMOVE", key: `K${index}` }) as EnvKeyEdit)],
    ["an invalid key", [{ op: "SET", key: "1A", value: "x" }] as EnvKeyEdit[]],
    ["a repeated key", [{ op: "SET", key: "A", value: "1" }, { op: "REMOVE", key: "A" }] as EnvKeyEdit[]],
    ["an over-long value", [{ op: "SET", key: "A", value: "x".repeat(8193) }] as EnvKeyEdit[]],
    ["a removal that carries a value", [{ op: "REMOVE", key: "A", value: "x" }] as unknown as EnvKeyEdit[]],
    ["an unknown operation", [{ op: "TRUNCATE", key: "A" }] as unknown as EnvKeyEdit[]],
    ["a non-string value", [{ op: "SET", key: "A", value: 1 }] as unknown as EnvKeyEdit[]],
  ])("refuses to send %s", (_label, edits) => {
    expect(editsProblem(edits)).toEqual(expect.any(String));
  });

  it("counts the value limit in characters like the backend", () => {
    const emoji = "😀".repeat(8192);
    expect(editsProblem([{ op: "SET", key: "A", value: emoji }])).toBeUndefined();
    expect(editsProblem([{ op: "SET", key: "A", value: `${emoji}x` }])).toEqual(
      expect.any(String),
    );
  });

  it("never echoes a value in a rejection", async () => {
    mockIPC(() => {
      throw { code: "VALIDATION_FAILED", message: "refused", retryable: false };
    });
    await previewEnvironmentCreate(GRANT_ID, [
      { op: "ADD", key: "API_TOKEN", value: SECRET_TEXT },
    ]).catch((error) => {
      expect(JSON.stringify(error)).not.toContain(SECRET_TEXT);
    });
  });
});

describe("environment preview decoding", () => {
  it("accepts a masked secret change and a shown non-secret change", () => {
    const preview = decodeEnvEditPreview(
      wirePreview({
        changes: [
          wireChange({ key: "API_TOKEN", secret: true, before: undefined, after: undefined }),
          wireChange({ key: "A", change: "ADD", before: undefined, after: "" }),
          wireChange({ key: "B", change: "REMOVE", before: "x", after: undefined }),
          wireChange({ key: "LONG", before: undefined, after: undefined, omitted: true }),
        ],
      }),
    );
    expect(preview.changes.map((change) => change.secret)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(preview.changes[0]).not.toHaveProperty("after");
    expect(preview.changes[1].after).toBe("");
  });

  it.each([
    ["a secret change carrying its new value", wireChange({ key: "API_TOKEN", secret: true, after: SECRET_TEXT })],
    ["a secret change carrying its old value", wireChange({ key: "API_TOKEN", secret: true, before: SECRET_TEXT, after: undefined })],
    ["a secret change flagged omitted", wireChange({ key: "API_TOKEN", secret: true, before: undefined, after: undefined, omitted: true })],
    ["an addition with an old value", wireChange({ change: "ADD", before: "x" })],
    ["a removal with a new value", wireChange({ change: "REMOVE", after: "x" })],
    ["a missing value that is not explained", wireChange({ after: undefined })],
    ["an omitted flag with nothing missing", wireChange({ omitted: true })],
    ["an unknown change kind", wireChange({ change: "RENAME" })],
    ["an invalid key", wireChange({ key: "A B" })],
    ["a non-boolean secret flag", wireChange({ secret: "yes" })],
    ["a non-string value", wireChange({ after: 5 })],
    ["a change that is not an object", "PORT"],
  ])("rejects %s", (_label, change) => {
    expect(() =>
      decodeEnvEditPreview(wirePreview({ changes: [change] })),
    ).toThrowError(expect.objectContaining({ code: "INTERNAL" }));
  });

  it.each([
    ["a raw text diff", { diff: { lines: [{ kind: "ADDED", text: `API_TOKEN=${SECRET_TEXT}` }], redacted: false, truncated: false } }],
    ["a diff that is not marked redacted", { diff: { lines: [], redacted: false, truncated: false } }],
    ["no changes", { changes: [] }],
    ["the same key twice", { changes: [wireChange(), wireChange()] }],
    ["more changes than the contract allows", { changes: Array.from({ length: 65 }, (_, index) => wireChange({ key: `K${index}` })) }],
    ["an unknown file kind", { fileKind: "SCRIPT" }],
    ["a non-boolean pattern flag", { matchesDefaultPatterns: "yes" }],
    ["a missing change list", { changes: undefined }],
    ["a create that has a recovery point", { kind: "CREATE", recoveryPoint: "BACKUP" }],
    ["a replace without a current hash", { currentHash: undefined }],
    ["an unknown write kind", { kind: "DELETE" }],
    ["a bad proposed hash", { proposedHash: "nope" }],
  ])("rejects a preview with %s", (_label, patch) => {
    expect(() => decodeEnvEditPreview(wirePreview(patch))).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it("rejects payloads that are not preview objects", () => {
    for (const value of [null, "preview", 3, [], {}]) {
      expect(() => decodeEnvEditPreview(value)).toThrowError(
        expect.objectContaining({ code: "INTERNAL" }),
      );
    }
  });

  it("does not echo payload content in decode errors", () => {
    try {
      decodeEnvEditPreview(
        wirePreview({
          changes: [wireChange({ key: "API_TOKEN", secret: true, after: SECRET_TEXT })],
        }),
      );
      throw new Error("expected a failure");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(SECRET_TEXT);
    }
  });
});
