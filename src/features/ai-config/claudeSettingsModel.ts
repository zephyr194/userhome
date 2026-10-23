import type {
  ClaudeLayerState,
  ClaudeLayerStateKind,
  ClaudeReadView,
  ClaudeSettingEntry,
} from "../../ipc/aiConfig";
import type { SelectGrantResult } from "../../ipc/grants";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { zhT } from "./aiConfigModel";

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

export const USER_LAYER_ID = "claude-user-settings";

const LAYER_TITLE_KEYS: Readonly<Record<string, MessageKey>> = {
  "claude-managed-settings": "aiConfig.claude.layer.managed",
  "claude-project-local-settings": "aiConfig.claude.layer.projectLocal",
  "claude-project-shared-settings": "aiConfig.claude.layer.projectShared",
  [USER_LAYER_ID]: "aiConfig.claude.layer.user",
  "claude-sign-in-metadata": "aiConfig.claude.layer.signIn",
};

export function layerTitle(id: string, t: TranslateFunction = zhT): string {
  const key = LAYER_TITLE_KEYS[id];
  return key === undefined ? id : t(key);
}

const STATE_KEYS: Readonly<Record<ClaudeLayerStateKind, MessageKey>> = {
  loaded: "aiConfig.claude.state.loaded",
  present: "aiConfig.claude.state.present",
  missing: "aiConfig.claude.state.missing",
  notSelected: "aiConfig.claude.state.notSelected",
  notApplicable: "aiConfig.claude.state.notApplicable",
  notReadable: "aiConfig.claude.state.notReadable",
  existsUnreadable: "aiConfig.claude.state.existsUnreadable",
  notRegularFile: "aiConfig.claude.state.notRegularFile",
  tooLarge: "aiConfig.claude.state.tooLarge",
  malformed: "aiConfig.claude.state.malformed",
};

export function layerStateText(state: ClaudeLayerState, t: TranslateFunction = zhT): string {
  if (state.kind === "malformed" && state.message) {
    return t("aiConfig.claude.state.malformedDetail", { message: state.message });
  }
  return t(STATE_KEYS[state.kind]);
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
export function entryBadges(entry: ClaudeSettingEntry, t: TranslateFunction = zhT): string[] {
  const badges: string[] = [];
  if (!entry.documented) badges.push(t("aiConfig.claude.badge.undocumented"));
  else if (entry.valueType === "unknown") badges.push(t("aiConfig.claude.badge.unverifiedType"));
  else badges.push(t("aiConfig.claude.badge.displayOnly"));
  if (entry.masked) badges.push(t("aiConfig.claude.badge.masked"));
  if (entry.merged) badges.push(t("aiConfig.claude.badge.merged"));
  return badges;
}

export function winnerText(entry: ClaudeSettingEntry, t: TranslateFunction = zhT): string {
  if (entry.merged) return t("aiConfig.claude.winner.merged");
  return entry.winner ? layerTitle(entry.winner, t) : "—";
}

export function overriddenText(entry: ClaudeSettingEntry, t: TranslateFunction = zhT): string {
  const overridden = entry.definedIn.filter((source) => source.overridden);
  if (overridden.length === 0) return t("aiConfig.claude.overridden.none");
  const layers = overridden
    .map((source) => layerTitle(source.layerId, t))
    .join(t("aiConfig.listSeparator"));
  return t("aiConfig.claude.overridden.list", { layers });
}

const MAX_VALUE_TEXT = 200;

export function valueText(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > MAX_VALUE_TEXT ? `${text.slice(0, MAX_VALUE_TEXT)}…` : text;
}
