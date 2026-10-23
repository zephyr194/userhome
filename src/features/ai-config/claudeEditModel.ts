import type {
  ClaudeEditAction,
  ClaudeEditDiffLine,
  ClaudeEditItem,
  ClaudeEditPreview,
  ClaudeEditRequest,
  ClaudeEditResult,
  ClaudeReadView,
} from "../../ipc/aiConfig";
import type { AppError } from "../../ipc/core";
import type { TranslateFunction } from "../../i18n";
import { zhT } from "./aiConfigModel";
import { USER_LAYER_ID, valueText } from "./claudeSettingsModel";

export type EditControl = "boolean" | "enum" | "string" | "none";
export type EditDraft = boolean | string;

const MAX_TEXT_VALUE_LENGTH = 256;

export function editControl(item: ClaudeEditItem): EditControl {
  if (!item.editable) return "none";
  if (item.valueType === "boolean") return "boolean";
  if (item.valueType === "enum" && item.allowedValues.length > 0) return "enum";
  if (item.valueType === "string") return "string";
  return "none";
}

export function initialDraft(item: ClaudeEditItem): EditDraft {
  switch (editControl(item)) {
    case "boolean":
      return false;
    case "enum":
      return item.allowedValues[0] ?? "";
    default:
      return "";
  }
}

export function editBlockedReason(
  item: ClaudeEditItem,
  settingsGrantId: string | null,
  t: TranslateFunction = zhT,
): string | null {
  if (!item.editable) return item.reason ?? t("aiConfig.edit.viewOnly");
  if (settingsGrantId === null) return t("aiConfig.edit.chooseFileFirst");
  return null;
}

export type EditRequestResult =
  | { readonly ok: true; readonly request: ClaudeEditRequest }
  | { readonly ok: false; readonly reason: string };

export function buildEditRequest(
  item: ClaudeEditItem,
  settingsGrantId: string,
  action: ClaudeEditAction,
  draft: EditDraft,
  t: TranslateFunction = zhT,
): EditRequestResult {
  const base = { grantId: settingsGrantId, keyPath: item.keyPath };
  if (action !== "set") return { ok: true, request: { ...base, action } };
  switch (editControl(item)) {
    case "boolean":
      return typeof draft === "boolean"
        ? { ok: true, request: { ...base, action, value: draft } }
        : { ok: false, reason: t("aiConfig.edit.invalidBoolean") };
    case "enum":
      return typeof draft === "string" && item.allowedValues.includes(draft)
        ? { ok: true, request: { ...base, action, value: draft } }
        : { ok: false, reason: t("aiConfig.edit.invalidEnum") };
    case "string":
      return typeof draft === "string" &&
        draft.trim().length > 0 &&
        draft.length <= MAX_TEXT_VALUE_LENGTH
        ? { ok: true, request: { ...base, action, value: draft } }
        : {
            ok: false,
            reason: t("aiConfig.edit.invalidText", { max: MAX_TEXT_VALUE_LENGTH }),
          };
    default:
      return { ok: false, reason: t("aiConfig.edit.notEditable") };
  }
}

export type EditPhase =
  | { readonly status: "idle" }
  | { readonly status: "previewing"; readonly action: ClaudeEditAction }
  | { readonly status: "previewed"; readonly preview: ClaudeEditPreview }
  | { readonly status: "confirming"; readonly preview: ClaudeEditPreview }
  | { readonly status: "saved"; readonly result: ClaudeEditResult }
  | { readonly status: "writeFailed"; readonly result: ClaudeEditResult }
  | { readonly status: "failed"; readonly error: AppError };

export type EditEvent =
  | { readonly type: "previewStart"; readonly action: ClaudeEditAction }
  | { readonly type: "previewReady"; readonly preview: ClaudeEditPreview }
  | { readonly type: "confirmStart" }
  | { readonly type: "confirmDone"; readonly result: ClaudeEditResult }
  | { readonly type: "failed"; readonly error: AppError }
  | { readonly type: "cancel" };

export function editReducer(state: EditPhase, event: EditEvent): EditPhase {
  switch (event.type) {
    case "previewStart":
      return state.status === "previewing" || state.status === "confirming"
        ? state
        : { status: "previewing", action: event.action };
    case "previewReady":
      return state.status === "previewing"
        ? { status: "previewed", preview: event.preview }
        : state;
    case "confirmStart":
      return state.status === "previewed"
        ? { status: "confirming", preview: state.preview }
        : state;
    case "confirmDone":
      if (state.status !== "confirming") return state;
      return event.result.outcome.status === "SUCCEEDED"
        ? { status: "saved", result: event.result }
        : { status: "writeFailed", result: event.result };
    case "failed":
      return { status: "failed", error: event.error };
    case "cancel":
      return state.status === "previewed" ||
        state.status === "failed" ||
        state.status === "saved" ||
        state.status === "writeFailed"
        ? { status: "idle" }
        : state;
    default:
      return state;
  }
}

export function diffSymbol(line: ClaudeEditDiffLine): string {
  return line.kind === "ADDED" ? "+" : "-";
}

export function recoveryNote(preview: ClaudeEditPreview, t: TranslateFunction = zhT): string {
  if (preview.kind === "CREATE") return t("aiConfig.edit.recoveryCreate");
  if (preview.recoveryPoint === "BACKUP") return t("aiConfig.edit.recoveryBackup");
  return t("aiConfig.edit.recoveryNone");
}

export function resultMessage(result: ClaudeEditResult, t: TranslateFunction = zhT): string {
  if (result.outcome.status === "SUCCEEDED") {
    return t("aiConfig.edit.saved", { note: result.reloadNote });
  }
  return result.outcome.error?.message ?? result.outcome.summary;
}

export interface SettingFilter {
  readonly query: string;
  readonly editableOnly: boolean;
}

export interface SettingGroups {
  readonly editable: readonly ClaudeEditItem[];
  readonly displayOnly: readonly ClaudeEditItem[];
}

export function groupSettings(
  items: readonly ClaudeEditItem[],
  filter: SettingFilter,
): SettingGroups {
  const needle = filter.query.trim().toLocaleLowerCase();
  const visible = items.filter(
    (item) =>
      needle === "" ||
      item.keyPath.toLocaleLowerCase().includes(needle) ||
      item.description.toLocaleLowerCase().includes(needle),
  );
  return {
    editable: visible.filter((item) => item.editable),
    displayOnly: filter.editableOnly
      ? []
      : visible.filter((item) => !item.editable),
  };
}

export function userLevelText(
  keyPath: string,
  view: ClaudeReadView | null,
  t: TranslateFunction = zhT,
): string {
  if (view === null) return t("aiConfig.edit.userNotRead");
  const entry = view.entries.find((candidate) => candidate.key === keyPath);
  if (!entry) return t("aiConfig.edit.userNotSet");
  const userSource = entry.definedIn.find(
    (source) => source.layerId === USER_LAYER_ID,
  );
  if (!userSource) return t("aiConfig.edit.userNotSet");
  if (entry.masked) return t("aiConfig.edit.userMasked");
  if (userSource.overridden || entry.merged) {
    return t("aiConfig.edit.userHiddenOverride");
  }
  return valueText(entry.value);
}

export interface SettingBadge {
  readonly label: string;
  readonly tone: "success" | "neutral" | "warning";
}

export function settingBadges(
  item: ClaudeEditItem,
  detectedVersion: string | null,
  t: TranslateFunction = zhT,
): readonly SettingBadge[] {
  const badges: SettingBadge[] = [
    item.editable
      ? { label: t("aiConfig.edit.badge.editable"), tone: "success" }
      : { label: t("aiConfig.claude.badge.displayOnly"), tone: "neutral" },
  ];
  if (!item.editable && item.verifiedVersion !== null) {
    badges.push({
      label: t("aiConfig.edit.badge.requiresVersion", { version: item.verifiedVersion }),
      tone: "warning",
    });
  }
  if (detectedVersion === null) {
    badges.push({ label: t("aiConfig.edit.badge.versionNotDetected"), tone: "warning" });
  }
  return badges;
}

export function versionNoteText(
  detectedVersion: string | null,
  items: readonly ClaudeEditItem[],
  t: TranslateFunction = zhT,
): string {
  const verified = [
    ...new Set(
      items.flatMap((item) =>
        item.verifiedVersion === null ? [] : [item.verifiedVersion],
      ),
    ),
  ];
  const detected =
    detectedVersion === null
      ? t("aiConfig.edit.version.notDetected")
      : t("aiConfig.edit.version.detected", { version: detectedVersion });
  const expected =
    verified.length === 0
      ? t("aiConfig.edit.version.noneVerified")
      : t("aiConfig.edit.version.verified", {
          versions: verified.join(t("aiConfig.listSeparator")),
        });
  return `${detected}${expected}`;
}
