import type {
  ClaudeLayerState,
  ClaudeLayerStateKind,
  ClaudeReadView,
  ClaudeSettingEntry,
} from "../../ipc/aiConfig";
import type { SelectGrantResult } from "../../ipc/grants";

export interface ProjectGrant {
  readonly id: string;
  readonly displayPath: string;
}

// A cancelled picker keeps the current choice; a selection replaces it. The
// picker itself is the existing directory-grant flow, so no new permission is
// requested here.
export function resolveSelection(
  result: SelectGrantResult,
  current: ProjectGrant | null,
): ProjectGrant | null {
  if (result.status === "CANCELLED") return current;
  return { id: result.grant.id, displayPath: result.grant.displayPath };
}

const LAYER_TITLES: Readonly<Record<string, string>> = {
  "claude-managed-settings": "托管设置（只读）",
  "claude-project-local-settings": "项目本地设置",
  "claude-project-shared-settings": "项目共享设置",
  "claude-user-settings": "用户设置",
  "claude-sign-in-metadata": "认证状态（仅元数据，不读取内容）",
};

export function layerTitle(id: string): string {
  return LAYER_TITLES[id] ?? id;
}

const STATE_TEXT: Readonly<Record<ClaudeLayerStateKind, string>> = {
  loaded: "已读取",
  present: "存在",
  missing: "不存在",
  notSelected: "未选择项目",
  notApplicable: "当前系统不适用",
  notReadable: "无法读取",
  existsUnreadable: "存在但不可读",
  notRegularFile: "不是普通文件，已忽略",
  tooLarge: "超过读取上限",
  malformed: "解析失败",
};

export function layerStateText(state: ClaudeLayerState): string {
  if (state.kind === "malformed" && state.message) return `解析失败：${state.message}`;
  return STATE_TEXT[state.kind];
}

const PARTIAL_STATES: readonly ClaudeLayerStateKind[] = [
  "notReadable",
  "existsUnreadable",
  "malformed",
  "tooLarge",
  "notRegularFile",
];

export function isPartialView(view: ClaudeReadView): boolean {
  return (
    view.warnings.length > 0 ||
    view.layers.some((layer) => PARTIAL_STATES.includes(layer.state.kind))
  );
}

// Every entry is display-only in this slice: the snapshot records no verified
// version range, so nothing is claimed as editable or fully supported.
export function entryBadges(entry: ClaudeSettingEntry): string[] {
  const badges: string[] = [];
  if (!entry.documented) badges.push("未登记定义·仅展示");
  else if (entry.valueType === "unknown") badges.push("类型未核实·仅展示");
  else badges.push("仅展示");
  if (entry.masked) badges.push("已遮盖");
  if (entry.merged) badges.push("列表合并");
  return badges;
}

export function winnerText(entry: ClaudeSettingEntry): string {
  if (entry.merged) return "多层合并";
  return entry.winner ? layerTitle(entry.winner) : "—";
}

export function overriddenText(entry: ClaudeSettingEntry): string {
  const overridden = entry.definedIn.filter((source) => source.overridden);
  if (overridden.length === 0) return "无被覆盖的来源";
  return `被覆盖：${overridden.map((source) => layerTitle(source.layerId)).join("、")}`;
}

const MAX_VALUE_TEXT = 200;

export function valueText(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > MAX_VALUE_TEXT ? `${text.slice(0, MAX_VALUE_TEXT)}…` : text;
}
