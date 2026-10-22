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
): string | null {
  if (!item.editable) return item.reason ?? "该设置仅供查看，暂不能修改。";
  if (settingsGrantId === null) return "请先选择要修改的用户设置文件。";
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
): EditRequestResult {
  const base = { grantId: settingsGrantId, keyPath: item.keyPath };
  if (action !== "set") return { ok: true, request: { ...base, action } };
  switch (editControl(item)) {
    case "boolean":
      return typeof draft === "boolean"
        ? { ok: true, request: { ...base, action, value: draft } }
        : { ok: false, reason: "取值无效：应为布尔值。" };
    case "enum":
      return typeof draft === "string" && item.allowedValues.includes(draft)
        ? { ok: true, request: { ...base, action, value: draft } }
        : { ok: false, reason: "取值无效：不在官方允许列表内。" };
    case "string":
      return typeof draft === "string" &&
        draft.trim().length > 0 &&
        draft.length <= MAX_TEXT_VALUE_LENGTH
        ? { ok: true, request: { ...base, action, value: draft } }
        : {
            ok: false,
            reason: `取值无效：应为非空文本，最长 ${MAX_TEXT_VALUE_LENGTH} 字符。`,
          };
    default:
      return { ok: false, reason: "该设置当前不能修改。" };
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

export function recoveryNote(preview: ClaudeEditPreview): string {
  if (preview.kind === "CREATE") return "文件尚不存在，将新建；没有恢复点。";
  if (preview.recoveryPoint === "BACKUP") {
    return "写入前会先备份当前文件；校验失败时恢复原内容。";
  }
  return "无法创建备份，本次不会写入。";
}

export function resultMessage(result: ClaudeEditResult): string {
  if (result.outcome.status === "SUCCEEDED") {
    return `已保存。${result.reloadNote}`;
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
): string {
  if (view === null) return "未读取";
  const entry = view.entries.find((candidate) => candidate.key === keyPath);
  if (!entry) return "未设置";
  const userSource = entry.definedIn.find(
    (source) => source.layerId === USER_LAYER_ID,
  );
  if (!userSource) return "未设置";
  if (entry.masked) return "已设置（内容已遮盖）";
  if (userSource.overridden || entry.merged) {
    return "已设置，但被其他来源覆盖或合并，此处不显示";
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
): readonly SettingBadge[] {
  const badges: SettingBadge[] = [
    item.editable
      ? { label: "可编辑", tone: "success" }
      : { label: "仅展示", tone: "neutral" },
  ];
  if (!item.editable && item.verifiedVersion !== null) {
    badges.push({ label: `需要版本 ${item.verifiedVersion}`, tone: "warning" });
  }
  if (detectedVersion === null) {
    badges.push({ label: "版本未检测", tone: "warning" });
  }
  return badges;
}

export function versionNoteText(
  detectedVersion: string | null,
  items: readonly ClaudeEditItem[],
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
      ? "未检测到本机版本。"
      : `本机版本：${detectedVersion}。`;
  const expected =
    verified.length === 0
      ? "尚无已验证版本。"
      : `已验证版本：${verified.join("、")}。`;
  return `${detected}${expected}`;
}
