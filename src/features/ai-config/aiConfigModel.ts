import type {
  AiConfigPresence,
  AiConfigReport,
  AiInstallStatus,
  AiInvalidReason,
  AiToolReport,
} from "../../ipc/aiConfig";
import type { AppError } from "../../ipc/core";

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
  { label: string; symbol: string; tone: AiBadgeTone }
> = {
  found: { label: "已找到", symbol: "✓", tone: "success" },
  missing: { label: "未找到", symbol: "○", tone: "warning" },
  invalid: { label: "无效", symbol: "!", tone: "danger" },
};

export const INVALID_REASON_TEXT: Record<AiInvalidReason, string> = {
  unreadable: "无法读取该位置",
  outsideRoot: "符号链接指向允许范围之外",
  notRegularFile: "不是普通文件",
  notExecutable: "没有可执行权限",
  groupOrWorldWritable: "组或其他用户可写，已拒绝运行",
};

export const CONFIG_LABELS: Record<
  AiConfigPresence,
  { text: string; symbol: string }
> = {
  found: { text: "已发现配置文件（不代表已安装）", symbol: "✓" },
  notFound: { text: "未发现配置文件", symbol: "○" },
  unavailable: { text: "无法检查配置位置", symbol: "!" },
  notRegistered: { text: "暂未提供配置位置", symbol: "–" },
};

export const NO_CONFIG_PATH_TEXT = "暂无";

export const UNCONFIRMED_VERSION_TEXT = "版本未确认";
export const NO_EXECUTABLE_TEXT = "未找到可执行文件";

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
