import { describe, expect, it } from "vitest";
import type { AppConfigFieldSpec, AppConfigFieldReadout } from "../../ipc/appConfig";
import {
  checkFieldDraft,
  collectChanges,
  editModes,
  fieldStatus,
  initialTextFor,
  issuesByPath,
  rawIssues,
  type FieldDrafts,
} from "./appConfigEditModel";

function spec(overrides: Partial<AppConfigFieldSpec> = {}): AppConfigFieldSpec {
  return {
    path: "user.name",
    label: "提交作者名",
    description: "每次提交时记录的作者名称。",
    kind: "string",
    enumValues: [],
    min: null,
    max: null,
    pattern: null,
    default: null,
    sensitive: false,
    ...overrides,
  };
}

const NAME = spec();
const EMAIL = spec({
  path: "user.email",
  pattern: { kind: "containsSeparator", separator: "@" },
});
const BRANCH = spec({
  path: "init.defaultBranch",
  pattern: { kind: "charset", allowed: "abcdefghijklmnopqrstuvwxyz0123456789._/-" },
});
const TABSIZE = spec({ path: "editor.tabSize", kind: "integer", min: 1, max: 8 });
const RATIO = spec({ path: "editor.ratio", kind: "number", min: 0, max: 1 });
const MODE = spec({
  path: "editor.mode",
  kind: "enum",
  enumValues: ["input", "always"],
});
const SWITCH = spec({ path: "editor.wrap", kind: "bool" });
const TOKEN = spec({ path: "auth.token", sensitive: true });

describe("editModes", () => {
  it("offers both tabs when visual and advanced are supported", () => {
    expect(editModes({ visualSupported: true, advancedSupported: true })).toEqual({
      tabs: ["fields", "raw"],
      initial: "fields",
    });
  });

  it("shows only the advanced mode when visual is unsupported", () => {
    expect(editModes({ visualSupported: false, advancedSupported: true })).toEqual({
      tabs: ["raw"],
      initial: "raw",
    });
  });

  it("shows only the visual mode when advanced is unsupported", () => {
    expect(editModes({ visualSupported: true, advancedSupported: false })).toEqual({
      tabs: ["fields"],
      initial: "fields",
    });
  });

  it("offers no mode when neither is supported", () => {
    expect(editModes({ visualSupported: false, advancedSupported: false })).toEqual({
      tabs: [],
      initial: null,
    });
  });
});

describe("checkFieldDraft", () => {
  it("rejects an empty string and points to the remove action", () => {
    expect(checkFieldDraft(NAME, { kind: "text", text: "   " })).toEqual({
      ok: false,
      message: "请输入内容；如需删除该项，点击“移除”。",
    });
  });

  it("rejects text longer than 256 characters", () => {
    const result = checkFieldDraft(NAME, { kind: "text", text: "a".repeat(257) });
    expect(result).toEqual({ ok: false, message: "不能超过 256 个字符。" });
  });

  it("rejects control characters", () => {
    const result = checkFieldDraft(NAME, { kind: "text", text: "a\tb" });
    expect(result.ok).toBe(false);
  });

  it("requires exactly one separator with text on both sides", () => {
    expect(checkFieldDraft(EMAIL, { kind: "text", text: "dev@example.com" })).toEqual({
      ok: true,
      value: "dev@example.com",
    });
    expect(checkFieldDraft(EMAIL, { kind: "text", text: "dev.example.com" }).ok).toBe(false);
    expect(checkFieldDraft(EMAIL, { kind: "text", text: "@example.com" }).ok).toBe(false);
    expect(checkFieldDraft(EMAIL, { kind: "text", text: "a@b@c" }).ok).toBe(false);
    expect(checkFieldDraft(EMAIL, { kind: "text", text: "a b@c" }).ok).toBe(false);
  });

  it("rejects characters outside the allowed charset", () => {
    expect(checkFieldDraft(BRANCH, { kind: "text", text: "release/2026.10" })).toEqual({
      ok: true,
      value: "release/2026.10",
    });
    expect(checkFieldDraft(BRANCH, { kind: "text", text: "main!" })).toEqual({
      ok: false,
      message: "包含不允许的字符，请只使用字母、数字和 . _ / - 。",
    });
  });

  it("accepts only whole numbers for integer fields and enforces the range", () => {
    expect(checkFieldDraft(TABSIZE, { kind: "text", text: "4" })).toEqual({ ok: true, value: 4 });
    expect(checkFieldDraft(TABSIZE, { kind: "text", text: "4.5" }).ok).toBe(false);
    expect(checkFieldDraft(TABSIZE, { kind: "text", text: "four" }).ok).toBe(false);
    expect(checkFieldDraft(TABSIZE, { kind: "text", text: "9" })).toEqual({
      ok: false,
      message: "超出允许范围（1 到 8）。",
    });
  });

  it("accepts decimal numbers for number fields and enforces the range", () => {
    expect(checkFieldDraft(RATIO, { kind: "text", text: "0.25" })).toEqual({ ok: true, value: 0.25 });
    expect(checkFieldDraft(RATIO, { kind: "text", text: "1.5" }).ok).toBe(false);
    expect(checkFieldDraft(RATIO, { kind: "text", text: "" }).ok).toBe(false);
  });

  it("accepts only listed values for enum fields", () => {
    expect(checkFieldDraft(MODE, { kind: "text", text: "always" })).toEqual({
      ok: true,
      value: "always",
    });
    expect(checkFieldDraft(MODE, { kind: "text", text: "never" }).ok).toBe(false);
  });

  it("treats boolean drafts and removals as valid", () => {
    expect(checkFieldDraft(SWITCH, { kind: "bool", value: true })).toEqual({ ok: true, value: true });
    expect(checkFieldDraft(SWITCH, { kind: "remove" })).toEqual({ ok: true, value: null });
  });
});

describe("collectChanges", () => {
  it("sends only the fields that were touched, with null for removals", () => {
    const drafts: FieldDrafts = {
      "user.name": { kind: "text", text: "Archie" },
      "editor.wrap": { kind: "remove" },
    };
    expect(collectChanges([NAME, SWITCH, TABSIZE], drafts)).toEqual({
      ok: true,
      changes: [
        { path: "user.name", value: "Archie" },
        { path: "editor.wrap", value: null },
      ],
    });
  });

  it("reports every invalid field by path and sends nothing", () => {
    const drafts: FieldDrafts = {
      "user.name": { kind: "text", text: "" },
      "editor.tabSize": { kind: "text", text: "99" },
    };
    const result = collectChanges([NAME, TABSIZE], drafts);
    expect(result).toEqual({
      ok: false,
      errors: {
        "user.name": "请输入内容；如需删除该项，点击“移除”。",
        "editor.tabSize": "超出允许范围（1 到 8）。",
      },
    });
  });

  it("ignores drafts for paths the schema does not declare", () => {
    expect(collectChanges([NAME], { "other.key": { kind: "remove" } })).toEqual({
      ok: true,
      changes: [],
    });
  });
});

describe("fieldStatus and initialTextFor", () => {
  const present = (path: string, value: AppConfigFieldReadout["value"]): AppConfigFieldReadout => ({
    path,
    present: true,
    value,
  });
  const absent = (path: string): AppConfigFieldReadout => ({ path, present: false, value: null });

  it("labels unset, set, edited, and to-be-removed fields in text", () => {
    expect(fieldStatus(NAME, absent(NAME.path), undefined)).toEqual({ label: "未设置", changed: false });
    expect(fieldStatus(NAME, present(NAME.path, "Archie"), undefined)).toEqual({
      label: "已设置",
      changed: false,
    });
    expect(fieldStatus(NAME, present(NAME.path, "Archie"), { kind: "text", text: "Bo" })).toEqual({
      label: "已修改",
      changed: true,
    });
    expect(fieldStatus(NAME, present(NAME.path, "Archie"), { kind: "remove" })).toEqual({
      label: "将移除",
      changed: true,
    });
  });

  it("never pre-fills a sensitive field and says the value is hidden", () => {
    expect(initialTextFor(TOKEN, present(TOKEN.path, null))).toBe("");
    expect(fieldStatus(TOKEN, present(TOKEN.path, null), undefined)).toEqual({
      label: "已设置（值已隐藏）",
      changed: false,
    });
  });

  it("pre-fills plain scalar values as text", () => {
    expect(initialTextFor(TABSIZE, present(TABSIZE.path, 4))).toBe("4");
    expect(initialTextFor(NAME, present(NAME.path, "Archie"))).toBe("Archie");
    expect(initialTextFor(NAME, absent(NAME.path))).toBe("");
  });
});

describe("rawIssues and issuesByPath", () => {
  it("keeps issues with a line number for the raw editor", () => {
    expect(
      rawIssues([
        { line: 3, message: "缺少逗号" },
        { path: "user.name", message: "不能为空" },
      ]),
    ).toEqual([{ line: 3, message: "缺少逗号" }]);
  });

  it("maps path issues onto the matching field", () => {
    expect(
      issuesByPath([
        { path: "user.name", message: "不能为空" },
        { line: 1, message: "语法错误" },
      ]),
    ).toEqual({ "user.name": "不能为空" });
  });
});
