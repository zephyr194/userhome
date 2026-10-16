import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import {
  INITIAL_ZSH_STATE,
  appliesToText,
  fileStatus,
  groupSameNames,
  needsFetch,
  pathSegmentText,
  reasonText,
  stepStatus,
  summarize,
  undeterminedText,
  valueStateText,
  zdotdirSummary,
  zshReducer,
  type ZshAction,
  type ZshState,
} from "./zshModel";

const GRANT = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const ERROR: AppError = { code: "NOT_FOUND", message: "gone", retryable: false };

function entry(overrides: Partial<ZshEntryRow> = {}): ZshEntryRow {
  return {
    kind: "ENTRY",
    line: 1,
    endLine: 1,
    name: "EDITOR",
    exported: true,
    operation: "SET",
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    state: "STATIC",
    ...overrides,
  };
}

function ready(rows: readonly ZshRow[]): ZshFile["outcome"] {
  return {
    status: "READY",
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: rows.length,
    secretCount: 0,
    dynamicCount: 0,
    unrecognizedCount: 0,
  };
}

function file(
  key: ZshFileKey,
  position: number,
  outcome: ZshFile["outcome"],
): ZshFile {
  const names = {
    ZSHENV: ".zshenv",
    ZPROFILE: ".zprofile",
    ZSHRC: ".zshrc",
    ZLOGIN: ".zlogin",
  } as const;
  const applies = {
    ZSHENV: "ALL",
    ZPROFILE: "LOGIN",
    ZSHRC: "INTERACTIVE",
    ZLOGIN: "LOGIN",
  } as const;
  return {
    file: key,
    name: names[key],
    appliesTo: applies[key],
    position,
    displayPath: `~/${names[key]}`,
    outcome,
  };
}

function overview(files: readonly ZshFile[]): ZshOverview {
  return {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: [],
    zdotdir: { status: "DEFAULT" },
    files,
  };
}

function run(actions: readonly ZshAction[], from: ZshState = INITIAL_ZSH_STATE) {
  return actions.reduce(zshReducer, from);
}

describe("zsh page state", () => {
  it("starts loading and accepts only the response of the current request", () => {
    const ov = overview([]);
    let state = run([{ type: "loadRequested", requestId: 1 }]);
    expect(state.load).toEqual({ status: "loading", requestId: 1 });

    // A response for an older request is ignored.
    state = run([{ type: "loadRequested", requestId: 2 }], state);
    expect(zshReducer(state, { type: "loaded", requestId: 1, overview: ov })).toBe(state);
    expect(zshReducer(state, { type: "loadFailed", requestId: 1, error: ERROR })).toBe(state);

    expect(zshReducer(state, { type: "loaded", requestId: 2, overview: ov }).load).toEqual({
      status: "ready",
      requestId: 2,
      overview: ov,
    });
    expect(
      zshReducer(state, { type: "loadFailed", requestId: 2, error: ERROR }).load,
    ).toEqual({ status: "error", requestId: 2, error: ERROR });
  });

  it("ignores a response once the request is no longer loading", () => {
    const ov = overview([]);
    const loaded = run([
      { type: "loadRequested", requestId: 1 },
      { type: "loaded", requestId: 1, overview: ov },
    ]);
    expect(zshReducer(loaded, { type: "loaded", requestId: 1, overview: ov })).toBe(loaded);
  });

  it("keeps the shown overview while a reload runs, and the user's directory choice", () => {
    const ov = overview([]);
    const state = run([
      { type: "loadRequested", requestId: 1 },
      { type: "loaded", requestId: 1, overview: ov },
      { type: "directoryChosen", grantId: GRANT },
      { type: "loadRequested", requestId: 2 },
    ]);
    expect(state.zdotdirGrantId).toBe(GRANT);
    expect(state.load).toEqual({ status: "loading", requestId: 2, previous: ov });
  });

  it("clears the directory choice", () => {
    const state = run([
      { type: "directoryChosen", grantId: GRANT },
      { type: "directoryCleared" },
    ]);
    expect(state.zdotdirGrantId).toBeUndefined();
  });
});

describe("zsh wording", () => {
  it("states which shells read each file", () => {
    expect(appliesToText("ALL").label).toBe("所有 zsh");
    expect(appliesToText("LOGIN").label).toBe("仅登录 shell");
    expect(appliesToText("INTERACTIVE").label).toBe("仅交互 shell");
    for (const kind of ["ALL", "LOGIN", "INTERACTIVE"] as const) {
      expect(appliesToText(kind).detail.length).toBeGreaterThan(5);
    }
  });

  it("marks dynamic and unresolved values and never calls them effective", () => {
    expect(valueStateText("STATIC").label).toBe("字面量");
    expect(valueStateText("REFERENCE").label).toBe("含引用（未解析）");
    expect(valueStateText("DYNAMIC").label).toBe("动态／未解析");
    for (const state of ["STATIC", "REFERENCE", "DYNAMIC"] as const) {
      expect(JSON.stringify(valueStateText(state))).not.toMatch(/生效值|有效值是/);
    }
  });

  it("has a label and an explanation for every dynamic reason", () => {
    const reasons = [
      "COMMAND_SUBSTITUTION",
      "ARITHMETIC",
      "UNRESOLVED_REFERENCE",
      "CONDITIONAL",
      "BLOCK",
      "SOURCE",
      "EVAL",
      "FUNCTION_DEFINITION",
      "ALIAS",
      "COMPOUND",
      "LINE_CONTINUATION",
      "HERE_DOC",
      "MULTILINE_QUOTE",
      "EXPANSION",
    ] as const;
    const labels = new Set<string>();
    for (const reason of reasons) {
      const text = reasonText(reason);
      expect(text.label).not.toBe("");
      expect(text.hint).not.toBe("");
      labels.add(text.label);
    }
    expect(labels.size).toBe(reasons.length);
  });

  it("explains every reason ZDOTDIR can be undetermined", () => {
    for (const reason of [
      "DYNAMIC",
      "MULTIPLE",
      "UNSUPPORTED_FORM",
      "ZSHENV_NOT_READ",
    ] as const) {
      expect(undeterminedText(reason)).toMatch(/ZDOTDIR|\.zshenv/);
    }
  });

  it("formats an empty PATH item as the current directory", () => {
    expect(pathSegmentText("")).toContain("当前目录");
    expect(pathSegmentText("/usr/bin")).toBe("/usr/bin");
  });
});

describe("zdotdir summary", () => {
  it("asks the user to choose only when it cannot be determined", () => {
    expect(zdotdirSummary({ status: "DEFAULT" })).toMatchObject({ needsChoice: false });
    expect(
      zdotdirSummary({ status: "STATIC", displayPath: "~/z", line: 1 }),
    ).toMatchObject({ needsChoice: false });
    expect(
      zdotdirSummary({ status: "OUTSIDE", displayPath: "/opt/z", line: 1 }),
    ).toMatchObject({ needsChoice: false, tone: "danger" });
    expect(
      zdotdirSummary({ status: "SELECTED", displayPath: "~/z" }),
    ).toMatchObject({ needsChoice: false, selected: true });
    const undetermined = zdotdirSummary({ status: "UNDETERMINED", reason: "DYNAMIC" });
    expect(undetermined).toMatchObject({ needsChoice: true, tone: "warning" });
    expect(undetermined.title).toContain("未确定");
    expect(undetermined.detail).toContain("选择");
  });

  it("states where the files are read from", () => {
    expect(zdotdirSummary({ status: "DEFAULT" }).detail).toContain("$HOME");
    expect(
      zdotdirSummary({ status: "STATIC", displayPath: "~/.config/zsh", line: 3 }).detail,
    ).toContain("~/.config/zsh");
    expect(
      zdotdirSummary({ status: "OUTSIDE", displayPath: "/opt/z", line: 3 }).title,
    ).toContain("越界");
  });

  it("shows why a chosen directory could not be used", () => {
    const summary = zdotdirSummary({
      status: "UNDETERMINED",
      reason: "DYNAMIC",
      selectionProblem: "授权已失效",
    });
    expect(summary.problem).toBe("授权已失效");
    expect(summary.needsChoice).toBe(true);
  });
});

describe("file status", () => {
  it("names every outcome", () => {
    expect(fileStatus(file("ZSHRC", 6, ready([]))).label).toBe("已读取");
    expect(
      fileStatus(
        file("ZSHRC", 6, { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "m" }),
      ),
    ).toMatchObject({ label: "不存在", tone: "neutral" });
    expect(
      fileStatus(
        file("ZSHRC", 6, { status: "UNAVAILABLE", reason: "TOO_LARGE", message: "m" }),
      ),
    ).toMatchObject({ label: "无法读取：文件过大（超过 1 MiB）", tone: "danger" });
    expect(
      fileStatus(file("ZSHRC", 6, { status: "OUTSIDE_HOME", message: "m" })).label,
    ).toBe("越界，未读取");
    expect(
      fileStatus(file("ZSHRC", 6, { status: "NOT_LOCATED", message: "m" })).label,
    ).toBe("位置未确定，未读取");
  });

  it("marks system-level steps as listed but not read", () => {
    expect(stepStatus({ scope: "SYSTEM" })).toBe("系统级，未读取");
    expect(stepStatus({ scope: "USER" })).toBeUndefined();
  });
});

describe("summaries", () => {
  it("is empty when no file exists and partial when some could not be read", () => {
    const missing = (key: ZshFileKey, position: number) =>
      file(key, position, { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "m" });
    expect(
      summarize(
        overview([
          missing("ZSHENV", 2),
          missing("ZPROFILE", 4),
          missing("ZSHRC", 6),
          missing("ZLOGIN", 8),
        ]),
      ),
    ).toEqual({ kind: "empty", problems: [] });
    expect(
      summarize(
        overview([
          file("ZSHENV", 2, ready([entry()])),
          missing("ZPROFILE", 4),
          file("ZSHRC", 6, { status: "OUTSIDE_HOME", message: "m" }),
          file("ZLOGIN", 8, { status: "NOT_LOCATED", message: "m" }),
        ]),
      ),
    ).toEqual({ kind: "partial", problems: [".zshrc：越界，未读取", ".zlogin：位置未确定，未读取"] });
    expect(
      summarize(overview([file("ZSHENV", 2, ready([entry()])), missing("ZPROFILE", 4)])),
    ).toEqual({ kind: "ok", problems: [] });
  });
});

describe("entries", () => {
  it("fetches secrets and long values only on request", () => {
    expect(needsFetch(entry())).toBe(false);
    expect(needsFetch(entry({ secret: true, value: undefined }))).toBe(true);
    expect(needsFetch(entry({ value: undefined, valueLength: 5000 }))).toBe(true);
    expect(needsFetch(entry({ hasValue: false, value: undefined, valueLength: 0 }))).toBe(false);
  });

  it("lists same-name entries side by side per file without choosing one", () => {
    const groups = groupSameNames(
      overview([
        file("ZSHENV", 2, ready([entry({ name: "EDITOR", value: "vim" }), entry({ name: "ONLY_HERE", line: 2 })])),
        file("ZPROFILE", 4, ready([entry({ name: "EDITOR", value: "nano", line: 7 })])),
        file("ZSHRC", 6, ready([entry({ name: "EDITOR", value: "$VISUAL", state: "DYNAMIC", reason: "UNRESOLVED_REFERENCE", line: 3 })])),
        file("ZLOGIN", 8, { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "m" }),
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("EDITOR");
    expect(groups[0]?.items.map((item) => [item.file, item.line, item.row.value])).toEqual([
      ["ZSHENV", 1, "vim"],
      ["ZPROFILE", 7, "nano"],
      ["ZSHRC", 3, "$VISUAL"],
    ]);
    expect(Object.keys(groups[0] ?? {})).toEqual(["name", "items"]);
  });

  it("groups repeated names within one file too and sorts groups by name", () => {
    const groups = groupSameNames(
      overview([
        file("ZSHRC", 6, ready([
          entry({ name: "ZED", line: 1 }),
          entry({ name: "ZED", line: 2 }),
          entry({ name: "ALPHA", line: 3 }),
          entry({ name: "ALPHA", line: 4 }),
        ])),
      ]),
    );
    expect(groups.map((group) => group.name)).toEqual(["ALPHA", "ZED"]);
  });

  it("treats PATH and path as the same variable family only by exact name", () => {
    const groups = groupSameNames(
      overview([
        file("ZSHENV", 2, ready([entry({ name: "PATH" })])),
        file("ZSHRC", 6, ready([entry({ name: "path" })])),
      ]),
    );
    expect(groups).toEqual([]);
  });
});
