import type {
  ClaudeCommandRequest,
  ClaudeOptionItem,
  ClaudeOptionRisk,
  ClaudeOptionValueType,
  ClaudeVersionStatus,
} from "../../ipc/aiConfig";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { zhT } from "./aiConfigModel";

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
  t: TranslateFunction = zhT,
): RequestPlan {
  const chosen = items.filter((item) => item.generatable && selectionOf(selection, item.id).checked);
  if (chosen.length === 0) return { status: "empty" };

  for (const item of chosen) {
    const state = selectionOf(selection, item.id);
    if (item.risks.length > 0 && !state.acknowledged) {
      return { status: "incomplete", message: t("aiConfig.cmd.riskConfirm", { id: item.id }) };
    }
    if (needsValueInput(item) && state.value.length === 0) {
      return { status: "incomplete", message: t("aiConfig.cmd.valueRequired", { id: item.id }) };
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

export const VALUE_TYPE_LABELS: Readonly<Record<ClaudeOptionValueType, MessageKey>> = {
  string: "aiConfig.cmd.valueType.string",
  boolean: "aiConfig.cmd.valueType.boolean",
  number: "aiConfig.cmd.valueType.number",
  stringArray: "aiConfig.cmd.valueType.stringArray",
  object: "aiConfig.cmd.valueType.object",
  enum: "aiConfig.cmd.valueType.enum",
  unknown: "aiConfig.cmd.valueType.unknown",
};

export const RISK_LABELS: Readonly<Record<ClaudeOptionRisk, MessageKey>> = {
  executesCommand: "aiConfig.cmd.risk.executesCommand",
  relaxesPermissions: "aiConfig.cmd.risk.relaxesPermissions",
  externalServer: "aiConfig.cmd.risk.externalServer",
};

export const NOTICE_LABELS: Readonly<Record<ClaudeVersionStatus, MessageKey>> = {
  compatible: "aiConfig.cmd.notice.compatible",
  unconfirmed: "aiConfig.cmd.notice.unconfirmed",
  incompatible: "aiConfig.cmd.notice.incompatible",
  notStated: "aiConfig.cmd.notice.notStated",
};

export const SECRET_NOTE_KEY: MessageKey = "aiConfig.cmd.secretNote";

export const RISK_CONFIRM_LABEL_KEY: MessageKey = "aiConfig.cmd.riskConfirmLabel";

export function versionText(item: ClaudeOptionItem, t: TranslateFunction = zhT): string {
  if (item.versions === null) return t("aiConfig.cmd.version.none");
  return t("aiConfig.cmd.version.min", { version: item.versions.min });
}

export function relationTexts(item: ClaudeOptionItem, t: TranslateFunction = zhT): string[] {
  return [
    ...item.excludes.map((other) => t("aiConfig.cmd.relation.excludes", { other })),
    ...item.requires.map((other) => t("aiConfig.cmd.relation.requires", { other })),
  ];
}

export function kindLabel(item: ClaudeOptionItem, t: TranslateFunction = zhT): string {
  return t(item.kind === "flag" ? "aiConfig.cmd.kind.flag" : "aiConfig.cmd.kind.env");
}
