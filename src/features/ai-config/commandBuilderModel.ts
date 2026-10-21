import type {
  ClaudeCommandRequest,
  ClaudeOptionItem,
  ClaudeOptionRisk,
  ClaudeOptionValueType,
  ClaudeVersionStatus,
} from "../../ipc/aiConfig";

export interface ItemSelection {
  readonly checked: boolean;
  readonly value: string;
  readonly acknowledged: boolean;
}

export type Selection = Readonly<Record<string, ItemSelection>>;

const UNSELECTED: ItemSelection = { checked: false, value: "", acknowledged: false };

export function selectionOf(selection: Selection, id: string): ItemSelection {
  return selection[id] ?? UNSELECTED;
}

export function updateItem(
  selection: Selection,
  id: string,
  patch: Partial<ItemSelection>,
): Selection {
  return { ...selection, [id]: { ...selectionOf(selection, id), ...patch } };
}

export type RequestPlan =
  | { readonly status: "empty" }
  | { readonly status: "incomplete"; readonly message: string }
  | { readonly status: "ready"; readonly request: ClaudeCommandRequest };

function takesValue(valueType: ClaudeOptionValueType): boolean {
  return valueType === "string" || valueType === "number" || valueType === "enum";
}

/** Whether the item shows a value control (secrets only ever get a placeholder). */
export function needsValueInput(item: ClaudeOptionItem): boolean {
  return item.generatable && !item.secret && takesValue(item.valueType);
}

/**
 * Turns the chosen items into a backend request. Incomplete choices stop here so
 * no request is sent; the backend still validates every field it receives.
 */
export function planRequest(
  items: readonly ClaudeOptionItem[],
  selection: Selection,
  detectedVersion: string,
): RequestPlan {
  const chosen = items.filter((item) => item.generatable && selectionOf(selection, item.id).checked);
  if (chosen.length === 0) return { status: "empty" };

  for (const item of chosen) {
    const state = selectionOf(selection, item.id);
    if (item.risks.length > 0 && !state.acknowledged) {
      return { status: "incomplete", message: `请先确认「${item.id}」的风险。` };
    }
    if (needsValueInput(item) && state.value.length === 0) {
      return { status: "incomplete", message: `请填写「${item.id}」的取值。` };
    }
  }

  const choices = chosen.map((item) => ({
    id: item.id,
    value: needsValueInput(item) ? selectionOf(selection, item.id).value : null,
  }));
  const trimmedVersion = detectedVersion.trim();
  return {
    status: "ready",
    request: {
      flags: choices.filter((_, index) => chosen[index].kind === "flag"),
      env: choices.filter((_, index) => chosen[index].kind === "env"),
      acknowledgedRisks: chosen
        .filter((item) => item.risks.length > 0)
        .map((item) => item.id),
      detectedVersion: trimmedVersion.length === 0 ? null : trimmedVersion,
    },
  };
}

export const VALUE_TYPE_LABELS: Readonly<Record<ClaudeOptionValueType, string>> = {
  string: "文本",
  boolean: "开关",
  number: "数字",
  stringArray: "列表",
  object: "对象",
  enum: "枚举",
  unknown: "类型未确认",
};

export const RISK_LABELS: Readonly<Record<ClaudeOptionRisk, string>> = {
  executesCommand: "执行命令",
  relaxesPermissions: "放宽权限",
  externalServer: "外部服务",
};

export const NOTICE_LABELS: Readonly<Record<ClaudeVersionStatus, string>> = {
  compatible: "版本满足",
  unconfirmed: "版本未确认",
  incompatible: "版本不兼容",
  notStated: "未给出版本要求",
};

export const SECRET_NOTE =
  "敏感项在命令中只生成占位符，需要你在本机自行替换。不要把真实密钥粘贴进共享位置。";

export const RISK_CONFIRM_LABEL = "我已了解该项可能放宽权限或执行命令";

export function versionText(item: ClaudeOptionItem): string {
  if (item.versions === null) return "文档未给出版本要求";
  return `需要 Claude Code ${item.versions.min} 或更高版本`;
}

export function relationTexts(item: ClaudeOptionItem): string[] {
  return [
    ...item.excludes.map((other) => `与 ${other} 互斥`),
    ...item.requires.map((other) => `需要同时选择 ${other}`),
  ];
}

export function kindLabel(item: ClaudeOptionItem): string {
  return item.kind === "flag" ? "命令行参数" : "环境变量";
}
