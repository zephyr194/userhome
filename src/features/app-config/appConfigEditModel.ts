import type {
  AppConfigFieldChange,
  AppConfigFieldReadout,
  AppConfigFieldSpec,
  AppConfigFieldValue,
  AppConfigPreviewIssue,
} from "../../ipc/appConfig";
import { ZH_COPY, type AppConfigCopy } from "./appConfigModel";

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
  copy: AppConfigCopy = ZH_COPY,
): { label: string; changed: boolean } {
  if (draft?.kind === "remove") return { label: copy.t("appConfig.field.status.remove"), changed: true };
  if (draft) return { label: copy.t("appConfig.field.status.modified"), changed: true };
  if (!readout?.present) return { label: copy.t("appConfig.field.status.unset"), changed: false };
  if (spec.sensitive) return { label: copy.t("appConfig.field.status.hidden"), changed: false };
  return { label: copy.t("appConfig.field.status.set"), changed: false };
}

export function checkFieldDraft(
  spec: AppConfigFieldSpec,
  draft: FieldDraft,
  copy: AppConfigCopy = ZH_COPY,
): FieldCheck {
  if (draft.kind === "remove") return { ok: true, value: null };
  if (draft.kind === "bool") return { ok: true, value: draft.value };
  switch (spec.kind) {
    case "string":
      return checkString(spec, draft.text, copy);
    case "integer":
      return checkNumber(spec, draft.text, true, copy);
    case "number":
      return checkNumber(spec, draft.text, false, copy);
    case "enum":
      return spec.enumValues.includes(draft.text)
        ? { ok: true, value: draft.text }
        : { ok: false, message: copy.t("appConfig.validate.chooseOption") };
    case "bool":
      return { ok: false, message: copy.t("appConfig.validate.useSwitch") };
  }
}

function checkString(spec: AppConfigFieldSpec, text: string, copy: AppConfigCopy): FieldCheck {
  if (text.trim().length === 0) {
    return { ok: false, message: copy.t("appConfig.validate.emptyText") };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, message: copy.t("appConfig.validate.tooLong", { max: MAX_TEXT_CHARS }) };
  }
  if (hasControlCharacter(text)) {
    return { ok: false, message: copy.t("appConfig.validate.controlChars") };
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
        message: copy.t("appConfig.validate.separator", { separator }),
      };
    }
  }
  if (pattern?.kind === "charset") {
    const allowed = pattern.allowed;
    if (![...text].every((character) => allowed.includes(character))) {
      return { ok: false, message: copy.t("appConfig.validate.charset") };
    }
  }
  return { ok: true, value: text };
}

function checkNumber(
  spec: AppConfigFieldSpec,
  text: string,
  integer: boolean,
  copy: AppConfigCopy,
): FieldCheck {
  const trimmed = text.trim();
  const shape = integer ? INTEGER_TEXT : DECIMAL_TEXT;
  const notANumber = copy.t(integer ? "appConfig.validate.integer" : "appConfig.validate.number");
  if (!shape.test(trimmed)) {
    return { ok: false, message: notANumber };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) {
    return { ok: false, message: notANumber };
  }
  const below = spec.min !== null && value < spec.min;
  const above = spec.max !== null && value > spec.max;
  if (below || above) {
    return {
      ok: false,
      message: copy.t("appConfig.range.outside", {
        min: rangeText(spec.min, copy.t("appConfig.range.noMin")),
        max: rangeText(spec.max, copy.t("appConfig.range.noMax")),
      }),
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
  copy: AppConfigCopy = ZH_COPY,
): CollectResult {
  const changes: AppConfigFieldChange[] = [];
  const errors: Record<string, string> = {};
  for (const spec of fields) {
    const draft = drafts[spec.path];
    if (!draft) continue;
    const checked = checkFieldDraft(spec, draft, copy);
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
