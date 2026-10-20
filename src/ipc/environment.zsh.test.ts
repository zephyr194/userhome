import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeZshOverview,
  readZshStartupFiles,
  revealZshValue,
  type ZshOverview,
} from "./environment";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const HASH = "a".repeat(64);

const ORDER = [
  [1, "SYSTEM", "/etc/zshenv", "ALL", null],
  [2, "USER", "~/.zshenv", "ALL", "ZSHENV"],
  [3, "SYSTEM", "/etc/zprofile", "LOGIN", null],
  [4, "USER", "~/.zprofile", "LOGIN", "ZPROFILE"],
  [5, "SYSTEM", "/etc/zshrc", "INTERACTIVE", null],
  [6, "USER", "~/.zshrc", "INTERACTIVE", "ZSHRC"],
  [7, "SYSTEM", "/etc/zlogin", "LOGIN", null],
  [8, "USER", "~/.zlogin", "LOGIN", "ZLOGIN"],
] as const;

function wireOrder() {
  return ORDER.map(([position, scope, pathLabel, appliesTo, file]) => ({
    position,
    scope,
    pathLabel,
    appliesTo,
    file,
    readByUserHome: scope === "USER",
  }));
}

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ENTRY",
    line: 2,
    endLine: 2,
    name: "EDITOR",
    exported: true,
    operation: "SET",
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    state: "STATIC",
    reason: null,
    pathSegments: null,
    ...overrides,
  };
}

function ready(rows: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: "READY",
    contentHash: HASH,
    sizeBytes: 120,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: 1,
    secretCount: 0,
    dynamicCount: 0,
    unrecognizedCount: 0,
    ...overrides,
  };
}

function wireFile(
  file: string,
  name: string,
  appliesTo: string,
  position: number,
  outcome: unknown,
  displayPath: string | null = `~/${name}`,
) {
  return { file, name, appliesTo, position, displayPath, outcome };
}

function wireOverview(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      url: "https://zsh.sourceforge.io/Doc/Release/Files.html",
      consultedOn: "2026-10-15",
    },
    order: wireOrder(),
    zdotdir: { status: "DEFAULT" },
    files: [
      wireFile("ZSHENV", ".zshenv", "ALL", 2, ready([entryRow()])),
      wireFile("ZPROFILE", ".zprofile", "LOGIN", 4, {
        status: "UNAVAILABLE",
        reason: "NOT_FOUND",
        message: "文件不存在或已被移动。",
      }),
      wireFile(
        "ZSHRC",
        ".zshrc",
        "INTERACTIVE",
        6,
        ready(
          [
            { kind: "BLANK", line: 1 },
            { kind: "COMMENT", line: 2, text: "# note", withheld: false },
            entryRow({
              line: 3,
              endLine: 3,
              name: "PATH",
              value: "/a:$PATH",
              valueLength: 8,
              state: "REFERENCE",
              pathSegments: [
                { text: "/a", state: "STATIC" },
                { text: "$PATH", state: "REFERENCE" },
                { text: "", state: "STATIC" },
              ],
            }),
            entryRow({
              line: 4,
              endLine: 4,
              name: "GITHUB_TOKEN",
              secret: true,
              valueLength: 12,
              value: null,
            }),
            entryRow({
              line: 5,
              endLine: 5,
              name: "GOPATH",
              value: "$(go env GOPATH)",
              valueLength: 16,
              state: "DYNAMIC",
              reason: "COMMAND_SUBSTITUTION",
            }),
            {
              kind: "DYNAMIC",
              line: 6,
              endLine: 8,
              reason: "BLOCK",
              text: "if true; then",
              withheld: false,
            },
            {
              kind: "DYNAMIC",
              line: 9,
              endLine: 9,
              reason: "CONDITIONAL",
              text: null,
              withheld: true,
            },
            {
              kind: "UNRECOGNIZED",
              line: 10,
              endLine: 10,
              text: "setopt autocd",
              withheld: false,
            },
          ],
          { entryCount: 4, secretCount: 1, dynamicCount: 3, unrecognizedCount: 1 },
        ),
      ),
      wireFile("ZLOGIN", ".zlogin", "LOGIN", 8, {
        status: "OUTSIDE_HOME",
        message: "越界",
      }),
    ],
    ...overrides,
  };
}

afterEach(() => {
  clearMocks();
});

describe("zsh startup IPC", () => {
  it("reads with no input at all by default, and never sends a path", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_zsh_startup_files");
      expect(payload).toEqual({ input: {} });
      return wireOverview();
    });

    const overview = await readZshStartupFiles();

    expect(overview.files.map((file) => file.file)).toEqual([
      "ZSHENV",
      "ZPROFILE",
      "ZSHRC",
      "ZLOGIN",
    ]);
  });

  it("passes only the directory authorization the user chose", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_zsh_startup_files");
      expect(payload).toEqual({ input: { zdotdirGrantId: GRANT_ID } });
      return wireOverview({
        zdotdir: { status: "SELECTED", displayPath: "~/.config/zsh" },
      });
    });

    const overview = await readZshStartupFiles(GRANT_ID);

    expect(overview.zdotdir).toEqual({
      status: "SELECTED",
      displayPath: "~/.config/zsh",
    });
  });

  it("reveals a value with only a file key, a line and a name", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("reveal_zsh_value");
      expect(payload).toEqual({
        input: { file: "ZSHRC", line: 4, name: "GITHUB_TOKEN" },
      });
      return { value: "tok-123" };
    });
    await expect(
      revealZshValue({ file: "ZSHRC", line: 4, name: "GITHUB_TOKEN" }),
    ).resolves.toBe("tok-123");

    mockIPC((_command, payload) => {
      expect(payload).toEqual({
        input: {
          file: "ZSHENV",
          line: 1,
          name: "A",
          zdotdirGrantId: GRANT_ID,
        },
      });
      return { value: "x" };
    });
    await expect(
      revealZshValue({ file: "ZSHENV", line: 1, name: "A" }, GRANT_ID),
    ).resolves.toBe("x");
  });

  it("refuses bad input before calling the backend", async () => {
    mockIPC(() => {
      throw new Error("must not be called");
    });
    const rejected = { code: "INVALID_INPUT" };

    await expect(readZshStartupFiles("../x")).rejects.toMatchObject(rejected);
    await expect(readZshStartupFiles("/Users/me/.config")).rejects.toMatchObject(
      rejected,
    );
    for (const target of [
      { file: "ZSHRC", line: 0, name: "A" },
      { file: "ZSHRC", line: 1.5, name: "A" },
      { file: "ZSHRC", line: 1, name: "1BAD" },
      { file: "ZSHRC", line: 1, name: "A;rm" },
      { file: "ZSHRC", line: 1, name: "" },
      { file: ".zshrc", line: 1, name: "A" },
      { file: "/etc/zshrc", line: 1, name: "A" },
    ]) {
      await expect(
        revealZshValue(target as Parameters<typeof revealZshValue>[0]),
      ).rejects.toMatchObject(rejected);
    }
    await expect(
      revealZshValue({ file: "ZSHRC", line: 1, name: "A" }, "not-a-grant"),
    ).rejects.toMatchObject(rejected);
  });
});

describe("zsh payload decoding", () => {
  it("decodes every row, outcome and zdotdir shape", () => {
    const overview: ZshOverview = decodeZshOverview(wireOverview());

    expect(overview.source).toEqual({
      url: "https://zsh.sourceforge.io/Doc/Release/Files.html",
      consultedOn: "2026-10-15",
    });
    expect(overview.order).toHaveLength(8);
    expect(overview.order[1]).toEqual({
      position: 2,
      scope: "USER",
      pathLabel: "~/.zshenv",
      appliesTo: "ALL",
      file: "ZSHENV",
      readByUserHome: true,
    });
    expect(overview.order[0]?.file).toBeUndefined();
    const zshrc = overview.files[2];
    if (zshrc?.outcome.status !== "READY") throw new Error("expected READY");
    const kinds = zshrc.outcome.rows.map((row) => row.kind);
    expect(kinds).toEqual([
      "BLANK",
      "COMMENT",
      "ENTRY",
      "ENTRY",
      "ENTRY",
      "DYNAMIC",
      "DYNAMIC",
      "UNRECOGNIZED",
    ]);
    const path = zshrc.outcome.rows[2];
    if (path?.kind !== "ENTRY") throw new Error("expected entry");
    expect(path.pathSegments).toEqual([
      { text: "/a", state: "STATIC" },
      { text: "$PATH", state: "REFERENCE" },
      { text: "", state: "STATIC" },
    ]);
    const secret = zshrc.outcome.rows[3];
    if (secret?.kind !== "ENTRY") throw new Error("expected entry");
    expect(secret.secret).toBe(true);
    expect(secret.value).toBeUndefined();
    const withheld = zshrc.outcome.rows[6];
    if (withheld?.kind !== "DYNAMIC") throw new Error("expected dynamic");
    expect(withheld).toMatchObject({ withheld: true, reason: "CONDITIONAL" });
    expect(withheld.text).toBeUndefined();
    expect(overview.files[1]?.outcome).toEqual({
      status: "UNAVAILABLE",
      reason: "NOT_FOUND",
      message: "文件不存在或已被移动。",
    });
    expect(overview.files[3]?.outcome.status).toBe("OUTSIDE_HOME");
  });

  it("decodes each zdotdir state", () => {
    const decode = (zdotdir: unknown) =>
      decodeZshOverview(wireOverview({ zdotdir })).zdotdir;
    expect(decode({ status: "DEFAULT" })).toEqual({ status: "DEFAULT" });
    expect(decode({ status: "STATIC", displayPath: "~/z", line: 2 })).toEqual({
      status: "STATIC",
      displayPath: "~/z",
      line: 2,
    });
    expect(decode({ status: "OUTSIDE", displayPath: "/opt/z", line: 1 })).toEqual({
      status: "OUTSIDE",
      displayPath: "/opt/z",
      line: 1,
    });
    expect(
      decode({ status: "UNDETERMINED", reason: "DYNAMIC", selectionProblem: null }),
    ).toEqual({ status: "UNDETERMINED", reason: "DYNAMIC" });
    expect(
      decode({
        status: "UNDETERMINED",
        reason: "MULTIPLE",
        selectionProblem: "授权已失效",
      }),
    ).toEqual({
      status: "UNDETERMINED",
      reason: "MULTIPLE",
      selectionProblem: "授权已失效",
    });
  });

  it("decodes not-located files only without a path", () => {
    const overview = decodeZshOverview(
      wireOverview({
        zdotdir: { status: "UNDETERMINED", reason: "DYNAMIC", selectionProblem: null },
        files: [
          wireFile("ZSHENV", ".zshenv", "ALL", 2, ready([])),
          wireFile(
            "ZPROFILE",
            ".zprofile",
            "LOGIN",
            4,
            { status: "NOT_LOCATED", message: "未确定" },
            null,
          ),
        ],
      }),
    );
    expect(overview.files[1]?.displayPath).toBeUndefined();
    expect(() =>
      decodeZshOverview(
        wireOverview({
          files: [
            wireFile("ZPROFILE", ".zprofile", "LOGIN", 4, {
              status: "NOT_LOCATED",
              message: "未确定",
            }),
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects malformed payloads", () => {
    const base = wireOverview();
    const withFiles = (files: unknown) => ({ ...base, files });
    const zshrcWith = (rows: unknown[], extra: Record<string, unknown> = {}) =>
      withFiles([
        wireFile("ZSHRC", ".zshrc", "INTERACTIVE", 6, ready(rows, extra)),
      ]);
    const bad: unknown[] = [
      null,
      "text",
      [],
      {},
      { ...base, source: { url: "http://x", consultedOn: "2026-10-15" } },
      { ...base, source: { url: "https://zsh.sourceforge.io/", consultedOn: "today" } },
      { ...base, order: [] },
      { ...base, order: wireOrder().slice(0, 7) },
      { ...base, order: wireOrder().map((step) => ({ ...step, position: 1 })) },
      {
        ...base,
        order: wireOrder().map((step) =>
          step.scope === "SYSTEM" ? { ...step, readByUserHome: true } : step,
        ),
      },
      {
        ...base,
        order: wireOrder().map((step) =>
          step.scope === "SYSTEM" ? { ...step, file: "ZSHENV" } : step,
        ),
      },
      { ...base, order: wireOrder().map((step) => ({ ...step, appliesTo: "ANY" })) },
      { ...base, zdotdir: { status: "SOMETHING" } },
      { ...base, zdotdir: { status: "STATIC", displayPath: "~/z" } },
      { ...base, zdotdir: { status: "STATIC", displayPath: "~/z", line: 0 } },
      { ...base, zdotdir: { status: "UNDETERMINED", reason: "NOPE" } },
      { ...base, zdotdir: { status: "UNDETERMINED", reason: "DYNAMIC", selectionProblem: 3 } },
      { ...base, files: "none" },
      { ...base, files: Array.from({ length: 5 }, () => base.files[0]) },
      withFiles([base.files[0], base.files[0]]),
      withFiles([{ ...base.files[0], file: "ZSHELL" }]),
      withFiles([{ ...base.files[0], position: 3 }]),
      withFiles([{ ...base.files[0], appliesTo: "LOGIN" }]),
      withFiles([{ ...base.files[0], name: ".zshrc" }]),
      withFiles([{ ...base.files[0], displayPath: "/etc/zshenv\n" }]),
      withFiles([{ ...base.files[0], outcome: { status: "READY" } }]),
      withFiles([{ ...base.files[0], outcome: { status: "MISSING" } }]),
      withFiles([
        { ...base.files[1], outcome: { status: "UNAVAILABLE", reason: "WHAT", message: "x" } },
      ]),
      withFiles([
        { ...base.files[1], outcome: { status: "UNAVAILABLE", reason: "IO", message: "" } },
      ]),
      withFiles([
        { ...base.files[1], outcome: { status: "OUTSIDE_HOME", message: 4 } },
      ]),
      zshrcWith([], { contentHash: "xyz" }),
      zshrcWith([], { sizeBytes: -1 }),
      zshrcWith([], { entryCount: 1.5 }),
      zshrcWith([], { rowsTruncated: "no" }),
      zshrcWith([{ kind: "WHAT", line: 1 }]),
      zshrcWith([{ kind: "BLANK", line: 0 }]),
      zshrcWith([{ kind: "BLANK" }]),
      zshrcWith([{ kind: "COMMENT", line: 1, text: "# x", withheld: true }]),
      zshrcWith([{ kind: "COMMENT", line: 1, withheld: false }]),
      zshrcWith([{ kind: "DYNAMIC", line: 1, endLine: 1, text: "x", withheld: false }]),
      zshrcWith([
        { kind: "DYNAMIC", line: 2, endLine: 1, reason: "SOURCE", text: "x", withheld: false },
      ]),
      zshrcWith([
        { kind: "DYNAMIC", line: 1, endLine: 1, reason: "MAGIC", text: "x", withheld: false },
      ]),
      zshrcWith([{ kind: "UNRECOGNIZED", line: 1, endLine: 1, withheld: false }]),
      zshrcWith([entryRow({ name: "1BAD" })]),
      zshrcWith([entryRow({ name: "A B" })]),
      zshrcWith([entryRow({ operation: "REPLACE" })]),
      zshrcWith([entryRow({ state: "MAYBE" })]),
      zshrcWith([entryRow({ endLine: 1, line: 2 })]),
      zshrcWith([entryRow({ hasValue: false })]),
      zshrcWith([entryRow({ valueLength: 5 })]),
      zshrcWith([entryRow({ secret: true })]),
      zshrcWith([entryRow({ state: "DYNAMIC", reason: null })]),
      zshrcWith([entryRow({ state: "STATIC", reason: "SOURCE" })]),
      zshrcWith([entryRow({ state: "REFERENCE", reason: "SOURCE" })]),
      zshrcWith([entryRow({ pathSegments: [{ text: "/a", state: "NOPE" }] })]),
      zshrcWith([entryRow({ pathSegments: "x" })]),
      zshrcWith([
        entryRow({ secret: true, value: null, pathSegments: [{ text: "/a", state: "STATIC" }] }),
      ]),
      zshrcWith(
        Array.from({ length: 5001 }, (_, index) => ({ kind: "BLANK", line: index + 1 })),
      ),
    ];
    for (const payload of bad) {
      expect(() => decodeZshOverview(payload), JSON.stringify(payload)?.slice(0, 160)).toThrow();
    }
  });

  it("counts value length in characters, not UTF-16 units", () => {
    const row = entryRow({ name: "GREETING", value: "你好😀", valueLength: 3 });
    const decoded = decodeZshOverview(
      wireOverview({
        files: [
          wireFile("ZSHRC", ".zshrc", "INTERACTIVE", 6, ready([row])),
        ],
      }),
    );
    expect(decoded.files).toHaveLength(1);
  });

  it("does not echo payload content in decode errors", () => {
    try {
      decodeZshOverview(
        wireOverview({
          files: [
            wireFile(
              "ZSHRC",
              ".zshrc",
              "INTERACTIVE",
              6,
              ready([entryRow({ secret: true, value: "hunter2" })]),
            ),
          ],
        }),
      );
      throw new Error("expected a failure");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("hunter2");
    }
  });
});

describe("zdotdir parent segments", () => {
  it("decodes a ZDOTDIR that was left undetermined because of a .. segment", () => {
    const overview = decodeZshOverview(
      wireOverview({
        zdotdir: { status: "UNDETERMINED", reason: "PARENT_SEGMENT", selectionProblem: null },
      }),
    );
    expect(overview.zdotdir).toEqual({ status: "UNDETERMINED", reason: "PARENT_SEGMENT" });
  });

  it("still refuses an unknown reason", () => {
    expect(() =>
      decodeZshOverview(
        wireOverview({
          zdotdir: { status: "UNDETERMINED", reason: "SOMETHING_ELSE", selectionProblem: null },
        }),
      ),
    ).toThrow();
  });
});
