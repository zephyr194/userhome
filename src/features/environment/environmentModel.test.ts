import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { EnvFileOutcome, ScanOutcome } from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import {
  DEFAULT_PATTERNS_TEXT,
  INITIAL_ENVIRONMENT_STATE,
  INITIAL_LAZY_VALUE,
  checkSettings,
  environmentReducer,
  failureText,
  flagText,
  formatBytes,
  lazyValueReducer,
  needsFetch,
  parsePatternsText,
  partialReasonText,
  sameSettings,
  skipReasonText,
  type EnvironmentAction,
  type EnvironmentState,
} from "./environmentModel";

const FIRST = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const SECOND = "4f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const ERROR: AppError = { code: "NOT_FOUND", message: "gone", retryable: false };

function grant(id: string, overrides: Partial<GrantSummary> = {}): GrantSummary {
  return {
    id,
    purpose: "CONFIG_DIRECTORY",
    kind: "DIRECTORY",
    displayPath: "~/proj",
    createdAtEpochMs: 1,
    ...overrides,
  };
}

const SCAN: ScanOutcome = {
  root: "~/proj",
  recursive: false,
  patterns: [".env"],
  files: [],
  skipped: [],
  skippedTotal: 0,
  excludedDirectories: 0,
  partialReasons: [],
  entriesExamined: 0,
  limits: { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 },
  exclusions: [],
};
const SETTINGS = { patterns: [".env"], recursive: false };
const UNAVAILABLE: EnvFileOutcome = {
  status: "UNAVAILABLE",
  reason: "NOT_FOUND",
  message: "x",
};

function run(
  actions: readonly EnvironmentAction[],
  from: EnvironmentState = INITIAL_ENVIRONMENT_STATE,
): EnvironmentState {
  return actions.reduce(environmentReducer, from);
}

describe("scan settings", () => {
  it("starts from the three default patterns, local only", () => {
    expect(parsePatternsText(DEFAULT_PATTERNS_TEXT)).toEqual([
      ".env",
      ".env.*",
      "*.env",
    ]);
    expect(INITIAL_ENVIRONMENT_STATE.recursive).toBe(false);
    expect(checkSettings(DEFAULT_PATTERNS_TEXT, false)).toEqual({
      ok: true,
      settings: { patterns: [".env", ".env.*", "*.env"], recursive: false },
    });
  });

  it("splits on whitespace and drops blanks and duplicates", () => {
    expect(parsePatternsText("  .env\n\n*.env  .env \t")).toEqual([".env", "*.env"]);
  });

  it.each([
    ["nothing", "  \n "],
    ["an absolute path", "/etc/*.env"],
    ["a parent segment", "../.env"],
    ["a middle parent segment", "a/../b"],
    ["a recursive glob", "**/.env"],
    ["a character class", "[ab].env"],
    ["a brace list", "{a,b}.env"],
    ["a command substitution", "$(id)"],
    ["an empty segment", "a//b"],
    ["a dot segment", "./x"],
    ["a very long pattern", "a".repeat(129)],
  ])("rejects %s with a reason", (_label, text) => {
    const result = checkSettings(text, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it("rejects more than 16 patterns", () => {
    const text = Array.from({ length: 17 }, (_, index) => `a${index}`).join("\n");
    expect(checkSettings(text, false).ok).toBe(false);
  });

  it("needs recursion for a pattern with a directory", () => {
    expect(checkSettings("config/*.env", false).ok).toBe(false);
    expect(checkSettings("config/*.env", true).ok).toBe(true);
  });

  it("compares settings structurally", () => {
    expect(sameSettings(SETTINGS, { patterns: [".env"], recursive: false })).toBe(true);
    expect(sameSettings(SETTINGS, { patterns: [".env"], recursive: true })).toBe(false);
    expect(sameSettings(SETTINGS, { patterns: [".env", "a"], recursive: false })).toBe(false);
  });
});

describe("environment page state", () => {
  it("keeps directory authorizations only and selects the first", () => {
    const state = run([
      {
        type: "grantsLoaded",
        grants: [
          grant("5f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b", { purpose: "CONFIG_FILE", kind: "FILE" }),
          grant(FIRST),
          grant(SECOND),
        ],
      },
    ]);

    expect(state.grants).toMatchObject({ status: "ready" });
    expect(state.grants.status === "ready" && state.grants.grants.map((item) => item.id)).toEqual([FIRST, SECOND]);
    expect(state.selectedGrantId).toBe(FIRST);
  });

  it("does not list the Caddy work directory among the generic directory authorizations", () => {
    const state = run([
      {
        type: "grantsLoaded",
        grants: [
          grant("5f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b", {
            purpose: "CADDY_WORK_DIR",
            displayPath: "~/.caddy",
          }),
          grant(FIRST),
        ],
      },
    ]);

    expect(state.grants.status === "ready" && state.grants.grants.map((item) => item.id)).toEqual([FIRST]);
    expect(state.selectedGrantId).toBe(FIRST);
  });

  it("does not list shell startup file grants among the directory authorizations", () => {
    const state = run([
      {
        type: "grantsLoaded",
        grants: [
          grant("5f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b", {
            purpose: "SHELL_STARTUP_FILE",
            kind: "FILE",
            displayPath: "~/.zshrc",
          }),
          grant(FIRST),
        ],
      },
    ]);
    expect(state.grants.status === "ready" && state.grants.grants.map((item) => item.id)).toEqual([FIRST]);
    expect(state.selectedGrantId).toBe(FIRST);
  });

  it("reaches the empty state when no directory is authorized", () => {
    const state = run([{ type: "grantsLoaded", grants: [] }]);
    expect(state.selectedGrantId).toBeUndefined();
    expect(state.grants).toEqual({ status: "ready", grants: [] });
  });

  it("clears the scan and the file when another directory is selected", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST), grant(SECOND)] },
      { type: "scanRequested", requestId: 1 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "fileRequested", requestId: 2, path: ".env" },
      { type: "grantSelected", grantId: SECOND },
    ]);

    expect(state.selectedGrantId).toBe(SECOND);
    expect(state.scan).toEqual({ status: "idle" });
    expect(state.file).toEqual({ status: "idle" });
    expect(state.selectedPath).toBeUndefined();
  });

  it("drops the selection and results when the authorization disappears", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST)] },
      { type: "scanRequested", requestId: 1 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "grantsLoaded", grants: [] },
    ]);

    expect(state.selectedGrantId).toBeUndefined();
    expect(state.scan).toEqual({ status: "idle" });
  });

  it("keeps the results when the same authorization is still listed", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST)] },
      { type: "scanRequested", requestId: 1 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "grantsLoaded", grants: [grant(FIRST)] },
    ]);

    expect(state.scan.status).toBe("ready");
  });

  it("clears everything when the authorization list cannot be loaded", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST)] },
      { type: "grantsFailed", error: ERROR },
    ]);

    expect(state.grants).toEqual({ status: "error", error: ERROR });
    expect(state.selectedGrantId).toBeUndefined();
  });

  it("ignores a scan answer that is not the current request", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST)] },
      { type: "scanRequested", requestId: 1 },
      { type: "scanRequested", requestId: 2 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
    ]);

    expect(state.scan).toEqual({ status: "loading", requestId: 2 });
  });

  it("ignores a scan answer after the directory changed", () => {
    const state = run([
      { type: "grantsLoaded", grants: [grant(FIRST), grant(SECOND)] },
      { type: "scanRequested", requestId: 1 },
      { type: "grantSelected", grantId: SECOND },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "scanFailed", requestId: 1, error: ERROR },
    ]);

    expect(state.scan).toEqual({ status: "idle" });
  });

  it("records a failed scan with its error", () => {
    const state = run([
      { type: "scanRequested", requestId: 1 },
      { type: "scanFailed", requestId: 1, error: ERROR },
    ]);

    expect(state.scan).toEqual({ status: "error", requestId: 1, error: ERROR });
  });

  it("starting a new scan resets the selected file", () => {
    const state = run([
      { type: "scanRequested", requestId: 1 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "fileRequested", requestId: 2, path: ".env" },
      { type: "scanRequested", requestId: 3 },
    ]);

    expect(state.file).toEqual({ status: "idle" });
    expect(state.selectedPath).toBeUndefined();
  });

  it("keeps the scanned settings when the editor changes afterwards", () => {
    const state = run([
      { type: "scanRequested", requestId: 1 },
      { type: "scanSucceeded", requestId: 1, outcome: SCAN, settings: SETTINGS },
      { type: "patternsChanged", text: "*.secrets" },
      { type: "recursiveChanged", recursive: true },
    ]);

    expect(state.scan).toMatchObject({ status: "ready", settings: SETTINGS });
    expect(state.patternsText).toBe("*.secrets");
    expect(state.recursive).toBe(true);
  });

  it("shows only the latest file and keeps unavailable results as results", () => {
    const state = run([
      { type: "fileRequested", requestId: 1, path: "a/.env" },
      { type: "fileRequested", requestId: 2, path: "b/.env" },
      { type: "fileLoaded", requestId: 1, outcome: UNAVAILABLE },
      { type: "fileLoaded", requestId: 2, outcome: UNAVAILABLE },
    ]);

    expect(state.file).toEqual({
      status: "loaded",
      requestId: 2,
      path: "b/.env",
      outcome: UNAVAILABLE,
    });
    expect(state.selectedPath).toBe("b/.env");
  });

  it("records a failed file read and ignores a stale failure", () => {
    const failed = run([
      { type: "fileRequested", requestId: 1, path: ".env" },
      { type: "fileFailed", requestId: 1, error: ERROR },
    ]);
    expect(failed.file).toMatchObject({ status: "error", error: ERROR });

    const stale = run([
      { type: "fileRequested", requestId: 1, path: ".env" },
      { type: "fileRequested", requestId: 2, path: ".env.local" },
      { type: "fileFailed", requestId: 1, error: ERROR },
    ]);
    expect(stale.file).toMatchObject({ status: "loading", requestId: 2 });
  });
});

describe("lazily fetched secret", () => {
  it("only holds the plaintext between a successful fetch and a discard", () => {
    let state = INITIAL_LAZY_VALUE;
    state = lazyValueReducer(state, { type: "loaded", value: "unrequested" });
    expect(state).toEqual({ status: "idle" });

    state = lazyValueReducer(state, { type: "load" });
    expect(state).toEqual({ status: "loading" });
    state = lazyValueReducer(state, { type: "loaded", value: "tok-123" });
    expect(state).toEqual({ status: "ready", value: "tok-123" });

    state = lazyValueReducer(state, { type: "discard" });
    expect(state).toEqual({ status: "idle" });
  });

  it("drops a late answer after a discard and reports a failure without a value", () => {
    let state = lazyValueReducer(INITIAL_LAZY_VALUE, { type: "load" });
    state = lazyValueReducer(state, { type: "discard" });
    state = lazyValueReducer(state, { type: "loaded", value: "late-secret" });
    expect(state).toEqual({ status: "idle" });

    state = lazyValueReducer(lazyValueReducer(state, { type: "load" }), {
      type: "failed",
      message: "文件已变化",
    });
    expect(state).toEqual({ status: "failed", message: "文件已变化" });
    expect(JSON.stringify(state)).not.toContain("secret");
  });
});

describe("wording", () => {
  it("explains every partial reason with the limit that was hit", () => {
    const limits = SCAN.limits;
    expect(partialReasonText("DEPTH_LIMIT", limits)).toContain("5 层");
    expect(partialReasonText("ENTRY_LIMIT", limits)).toContain("2000");
    expect(partialReasonText("MATCH_LIMIT", limits)).toContain("200");
    expect(partialReasonText("UNREADABLE_DIRECTORY", limits)).toContain("权限");
  });

  it("labels skips, failures and flags", () => {
    expect(skipReasonText("OUTSIDE_LINK")).toContain("之外");
    expect(failureText("TOO_LARGE")).toContain("1 MiB");
    expect(failureText("NOT_FOUND")).not.toBe(failureText("PERMISSION_DENIED"));
    expect(flagText("DUPLICATE_KEY").label).toContain("冲突");
    expect(flagText("COMMAND_SUBSTITUTION").hint).toContain("没有执行");
    expect(flagText("INTERPOLATION").label).toContain("动态");
    expect(flagText("MULTILINE_VALUE").label).toContain("不支持");
  });

  it("formats sizes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB");
  });

  it("fetches values for secrets and for long values only", () => {
    const base = {
      kind: "ENTRY",
      line: 1,
      endLine: 1,
      key: "A",
      exported: false,
      secret: false,
      hasValue: true,
      valueLength: 1,
      quote: "NONE",
      flags: [],
    } as const;
    expect(needsFetch({ ...base, value: "x" })).toBe(false);
    expect(needsFetch({ ...base, secret: true })).toBe(true);
    expect(needsFetch(base)).toBe(true);
    expect(needsFetch({ ...base, hasValue: false, valueLength: 0 })).toBe(false);
  });
});
