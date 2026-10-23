import type {
  AppConfigFieldChange,
  AppConfigFieldReadout,
  AppConfigFieldSpec,
  AppConfigFieldValue,
  AppConfigPreviewIssue,
} from "../../ipc/appConfig";

export type EditTab = "fields" | "raw";

export type FieldDraft =
  | { kind: "text"; text: string }
  | { kind: "bool"; value: boolean }
  | { kind: "remove" };

export type FieldDrafts = Readonly<Record<string, FieldDraft>>;

export type FieldCheck =
  | { ok: true; value: AppConfigFieldValue }
  | { ok: false; message: string };

export type CollectResult =
  | { ok: true; changes: AppConfigFieldChange[] }
  | { ok: false; errors: Record<string, string> };

const MAX_TEXT_CHARS = 256;
const INTEGER_TEXT = /^[+-]?\d+$/;
const DECIMAL_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function editModes(schema: {
  visualSupported: boolean;
  advancedSupported: boolean;
}): { tabs: EditTab[]; initial: EditTab | null } {
  const tabs: EditTab[] = [];
  if (schema.visualSupported) tabs.push("fields");
  if (schema.advancedSupported) tabs.push("raw");
  return { tabs, initial: tabs[0] ?? null };
}

export function initialTextFor(
  spec: AppConfigFieldSpec,
  readout: AppConfigFieldReadout | undefined,
): string {
  if (spec.sensitive || !readout || !readout.present) return "";
  if (readout.value === null || typeof readout.value === "boolean") return "";
  return String(readout.value);
}

export function fieldStatus(
  spec: AppConfigFieldSpec,
  readout: AppConfigFieldReadout | undefined,
  draft: FieldDraft | undefined,
): { label: string; changed: boolean } {
  if (draft?.kind === "remove") return { label: "将移除", changed: true };
  if (draft) return { label: "已修改", changed: true };
  if (!readout?.present) return { label: "未设置", changed: false };
  if (spec.sensitive) return { label: "已设置（值已隐藏）", changed: false };
  return { label: "已设置", changed: false };
}

export function checkFieldDraft(spec: AppConfigFieldSpec, draft: FieldDraft): FieldCheck {
  if (draft.kind === "remove") return { ok: true, value: null };
  if (draft.kind === "bool") return { ok: true, value: draft.value };
  switch (spec.kind) {
    case "string":
      return checkString(spec, draft.text);
    case "integer":
      return checkNumber(spec, draft.text, true);
    case "number":
      return checkNumber(spec, draft.text, false);
    case "enum":
      return spec.enumValues.includes(draft.text)
        ? { ok: true, value: draft.text }
        : { ok: false, message: "请选择列表中的一个值。" };
    case "bool":
      return { ok: false, message: "请用开关设置该项。" };
  }
}

function checkString(spec: AppConfigFieldSpec, text: string): FieldCheck {
  if (text.trim().length === 0) {
    return { ok: false, message: "请输入内容；如需删除该项，点击“移除”。" };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, message: `不能超过 ${MAX_TEXT_CHARS} 个字符。` };
  }
  if (hasControlCharacter(text)) {
    return { ok: false, message: "不能包含控制字符。" };
  }
  const pattern = spec.pattern;
  if (pattern?.kind === "containsSeparator") {
    const separator = pattern.separator;
    const [before, after, ...rest] = text.split(separator);
    const valid =
      rest.length === 0 &&
      after !== undefined &&
      before !== "" &&
      after !== "" &&
      !/\s/.test(text);
    if (!valid) {
      return {
        ok: false,
        message: `格式不正确，需要包含一个 ${separator}，前后都有内容，且中间不能有空格。`,
      };
    }
  }
  if (pattern?.kind === "charset") {
    const allowed = pattern.allowed;
    if (![...text].every((character) => allowed.includes(character))) {
      return { ok: false, message: "包含不允许的字符，请只使用字母、数字和 . _ / - 。" };
    }
  }
  return { ok: true, value: text };
}

function checkNumber(spec: AppConfigFieldSpec, text: string, integer: boolean): FieldCheck {
  const trimmed = text.trim();
  const shape = integer ? INTEGER_TEXT : DECIMAL_TEXT;
  if (!shape.test(trimmed)) {
    return {
      ok: false,
      message: integer ? "请输入整数。" : "请输入数字。",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) {
    return { ok: false, message: integer ? "请输入整数。" : "请输入数字。" };
  }
  const below = spec.min !== null && value < spec.min;
  const above = spec.max !== null && value > spec.max;
  if (below || above) {
    return {
      ok: false,
      message: `超出允许范围（${rangeText(spec.min, "无下限")} 到 ${rangeText(spec.max, "无上限")}）。`,
    };
  }
  return { ok: true, value };
}

function rangeText(bound: number | null, fallback: string): string {
  return bound === null ? fallback : String(bound);
}

export function collectChanges(
  fields: readonly AppConfigFieldSpec[],
  drafts: FieldDrafts,
): CollectResult {
  const changes: AppConfigFieldChange[] = [];
  const errors: Record<string, string> = {};
  for (const spec of fields) {
    const draft = drafts[spec.path];
    if (!draft) continue;
    const checked = checkFieldDraft(spec, draft);
    if (checked.ok) {
      changes.push({ path: spec.path, value: checked.value });
    } else {
      errors[spec.path] = checked.message;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes };
}

export function rawIssues(
  issues: readonly AppConfigPreviewIssue[],
): Array<{ line: number; message: string }> {
  return issues.flatMap((issue) =>
    issue.line === undefined ? [] : [{ line: issue.line, message: issue.message }],
  );
}

export function issuesByPath(issues: readonly AppConfigPreviewIssue[]): Record<string, string> {
  const byPath: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.path !== undefined && byPath[issue.path] === undefined) {
      byPath[issue.path] = issue.message;
    }
  }
  return byPath;
}
