import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  DEFAULT_ENV_PATTERNS,
  decodeEnvFileOutcome,
  decodeRevealedValue,
  decodeScanOutcome,
  isSafeRelativePath,
  readEnvironmentFile,
  revealEnvironmentValue,
  scanEnvironmentFiles,
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
