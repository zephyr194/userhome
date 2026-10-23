import type {
  AiConfigPresence,
  AiConfigReport,
  AiInstallStatus,
  AiInvalidReason,
  AiToolReport,
} from "../../ipc/aiConfig";
import { translate, type Locale, type MessageKey, type TranslateFunction } from "../../i18n";
import { aiConfigDefinitionEn } from "../../i18n/messages/aiConfig";
import type { AppError } from "../../ipc/core";

/** Model helpers default to zh-CN so their callers and tests keep the original text. */
export const zhT: TranslateFunction = (key, params) => translate("zh-CN", key, params);

/** Definition text stays in the source language unless the English catalogue has a copy for this key. */
export function definitionDescription(keyPath: string, description: string, locale: Locale): string {
  if (locale !== "en") return description;
  return aiConfigDefinitionEn[keyPath] ?? description;
}

export type AiConfigState =
  | { status: "loading" }
  | { status: "ready"; report: AiConfigReport }
  | { status: "failed"; error: AppError };

export type AiConfigSummary = "loading" | "empty" | "partial" | "ready" | "error";

export type AiBadgeTone = "neutral" | "success" | "warning" | "danger";

/** A tool is inconclusive when its install check or its config check could not finish. */
export function isInconclusive(tool: AiToolReport): boolean {
  return tool.installStatus === "invalid" || tool.configPresence === "unavailable";
}

export function summarizeState(state: AiConfigState): AiConfigSummary {
  if (state.status === "loading") return "loading";
  if (state.status === "failed") return "error";
  if (state.report.tools.length === 0) return "empty";
  return state.report.tools.some(isInconclusive) ? "partial" : "ready";
}

export function countInconclusive(report: AiConfigReport): number {
  return report.tools.filter(isInconclusive).length;
}

export const INSTALL_LABELS: Record<
  AiInstallStatus,
  { labelKey: MessageKey; symbol: string; tone: AiBadgeTone }
> = {
  found: { labelKey: "aiConfig.install.found", symbol: "✓", tone: "success" },
  missing: { labelKey: "aiConfig.install.missing", symbol: "○", tone: "warning" },
  invalid: { labelKey: "aiConfig.install.invalid", symbol: "!", tone: "danger" },
};

export const INVALID_REASON_KEYS: Record<AiInvalidReason, MessageKey> = {
  unreadable: "aiConfig.invalidReason.unreadable",
  outsideRoot: "aiConfig.invalidReason.outsideRoot",
  notRegularFile: "aiConfig.invalidReason.notRegularFile",
  notExecutable: "aiConfig.invalidReason.notExecutable",
  groupOrWorldWritable: "aiConfig.invalidReason.groupOrWorldWritable",
};

export const CONFIG_LABELS: Record<
  AiConfigPresence,
  { textKey: MessageKey; symbol: string }
> = {
  found: { textKey: "aiConfig.config.found", symbol: "✓" },
  notFound: { textKey: "aiConfig.config.notFound", symbol: "○" },
  unavailable: { textKey: "aiConfig.config.unavailable", symbol: "!" },
  notRegistered: { textKey: "aiConfig.config.notRegistered", symbol: "–" },
};

export const NO_CONFIG_PATH_KEY = "aiConfig.config.noPath";

export const UNCONFIRMED_VERSION_KEY = "aiConfig.version.unconfirmed";
export const NO_EXECUTABLE_KEY = "aiConfig.executable.none";

export const CLAUDE_CODE_TOOL_ID = "claude-code";

/** Falls back to the first tool when the selected id is no longer in the report. */
export function selectedToolOf(
  tools: readonly AiToolReport[],
  selectedId: string,
): AiToolReport | undefined {
  return tools.find((tool) => tool.id === selectedId) ?? tools[0];
}

/** Without a report there is no tool to select, so the Claude Code panels stay as before. */
export function showsClaudePanel(selected: AiToolReport | undefined): boolean {
  return selected === undefined || selected.id === CLAUDE_CODE_TOOL_ID;
}
