import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import {
  DEFAULT_PATTERNS_TEXT,
  INITIAL_LAZY_VALUE,
  checkSettings,
  failureText,
  flagText,
  lazyValueReducer,
  parsePatternsText,
  partialReasonText,
  sameSettings,
  skipReasonText,
} from "./environmentModel";

const SETTINGS = { patterns: [".env"], recursive: false };
const LIMITS = { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 };

describe("scan settings", () => {
  it("starts from the three default patterns, local only", () => {
    expect(parsePatternsText(DEFAULT_PATTERNS_TEXT)).toEqual([
      ".env",
      ".env.*",
      "*.env",
    ]);
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
    const limits = LIMITS;
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
    expect(flagText("DUPLICATE_KEY").hint).toContain("最后一处生效");
    expect(flagText("DUPLICATE_KEY").hint).not.toContain("不会判断");
    expect(flagText("COMMAND_SUBSTITUTION").hint).toContain("没有执行");
    expect(flagText("INTERPOLATION").label).toContain("动态");
    expect(flagText("MULTILINE_VALUE").label).toContain("不支持");
  });

  it("gives flags a zh-CN label and hint by default and an English one with a translator", () => {
    expect(flagText("MULTILINE_VALUE").label).toBe("不支持：多行值");
    const english = flagText("DUPLICATE_KEY", (key, params) => translate("en", key, params));
    expect(english.label).toBe("Conflict: duplicate key");
    expect(/[㐀-鿿]/.test(english.hint)).toBe(false);
    expect(flagText("DUPLICATE_KEY", (key) => key)).toEqual({
      label: "env.model.flag.duplicateKey.label",
      hint: "env.model.flag.duplicateKey.hint",
    });
  });

});
