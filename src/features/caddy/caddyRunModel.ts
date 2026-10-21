import { DEFAULT_LOG_MAX_LINES } from "../../components/ui/logBuffer";
import type {
  CaddyAppliedState,
  CaddyApplyFailure,
  CaddyApplyReport,
  CaddyInstanceReview,
  CaddyLogPage,
  CaddyRunState,
} from "../../ipc/caddy";

export const LOG_LINE_LIMIT = DEFAULT_LOG_MAX_LINES;

export interface RunStateView {
  label: string;
  symbol: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

const RUN_STATE_VIEWS: Record<CaddyRunState, RunStateView> = {
  STOPPED: { label: "已停止", symbol: "○", tone: "neutral" },
  STARTING: { label: "开启中", symbol: "◐", tone: "warning" },
  RUNNING: { label: "运行中", symbol: "●", tone: "success" },
  STOPPING: { label: "停止中", symbol: "◐", tone: "warning" },
  FAILED: { label: "失败", symbol: "▲", tone: "danger" },
  UNKNOWN: { label: "状态未知", symbol: "◇", tone: "warning" },
};

export function presentRunState(state: CaddyRunState): RunStateView {
  return RUN_STATE_VIEWS[state];
}

export function canPrepare(state: CaddyRunState): boolean {
  return state === "STOPPED" || state === "FAILED";
}

export function canStart(state: CaddyRunState, hasPlan: boolean): boolean {
  return canPrepare(state) && hasPlan;
}

export function canStop(state: CaddyRunState): boolean {
  return state === "STARTING" || state === "RUNNING";
}

const APPLIED_VIEWS: Record<CaddyAppliedState, RunStateView> = {
  APPLIED: { label: "与运行中的配置一致", symbol: "✓", tone: "success" },
  PENDING: { label: "未应用", symbol: "△", tone: "warning" },
  UNKNOWN: { label: "应用状态未知", symbol: "◇", tone: "warning" },
};

export function presentApplied(applied: CaddyAppliedState): RunStateView {
  return APPLIED_VIEWS[applied];
}

export function canApply(
  state: CaddyRunState,
  applied: CaddyAppliedState | undefined,
  busy: boolean,
): boolean {
  return state === "RUNNING" && applied === "PENDING" && !busy;
}

const FAILURE_LABELS: Record<CaddyApplyFailure, string> = {
  VALIDATION_FAILED: "校验失败",
  PREPARATION_FAILED: "准备失败",
  COMMAND_FAILED: "命令失败",
  TIMEOUT: "超时",
  REVIEW_FAILED: "复核失败",
};

export function applyFailureLabel(failure: CaddyApplyFailure): string {
  return FAILURE_LABELS[failure];
}

const CONFIG_LABELS: Record<CaddyInstanceReview["config"], string> = {
  PREVIOUS: "活动配置仍为旧版本",
  CANDIDATE: "活动配置已记录为新版本",
  UNKNOWN: "活动配置未知",
};

export function reviewLines(review: CaddyInstanceReview): string[] {
  return [
    review.alive ? "进程存活" : "进程已不在运行",
    review.adminReachable ? "管理端点可连接" : "管理端点不可连接",
    CONFIG_LABELS[review.config],
  ];
}

// An apply result belongs to one own session; a result from an earlier session is hidden.
export function visibleApplyResult(
  result: CaddyApplyReport | undefined,
  sessionId: string | undefined,
): CaddyApplyReport | undefined {
  return result !== undefined && result.sessionId === sessionId ? result : undefined;
}

export interface LogView {
  sessionId?: string;
  stdoutOffset: number;
  stderrOffset: number;
  stdoutCarry: string;
  stderrCarry: string;
  lines: readonly string[];
  dropped: number;
}

export function initialLogView(sessionId: string | undefined): LogView {
  return {
    sessionId,
    stdoutOffset: 0,
    stderrOffset: 0,
    stdoutCarry: "",
    stderrCarry: "",
    lines: [],
    dropped: 0,
  };
}

// A trailing partial line waits for its line break, so a line split across two
// polls is shown once and whole.
export function takeCompleteLines(
  carry: string,
  chunk: string,
): { lines: string[]; pending: string } {
  const parts = (carry + chunk).split("\n");
  const pending = parts.pop() ?? "";
  return {
    lines: parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)),
    pending,
  };
}

export function applyLogPage(view: LogView, page: CaddyLogPage): LogView {
  if (
    page.stdout === "" &&
    page.stderr === "" &&
    page.stdoutOffset === view.stdoutOffset &&
    page.stderrOffset === view.stderrOffset
  ) {
    return view;
  }
  const stdout = takeCompleteLines(view.stdoutCarry, page.stdout);
  const stderr = takeCompleteLines(view.stderrCarry, page.stderr);
  const added = [
    ...stdout.lines.map((line) => `[out] ${line}`),
    ...stderr.lines.map((line) => `[err] ${line}`),
  ];
  const combined = view.lines.concat(added);
  const overflow = Math.max(0, combined.length - LOG_LINE_LIMIT);
  return {
    sessionId: page.sessionId,
    stdoutOffset: page.stdoutOffset,
    stderrOffset: page.stderrOffset,
    stdoutCarry: stdout.pending,
    stderrCarry: stderr.pending,
    lines: overflow > 0 ? combined.slice(overflow) : combined,
    dropped: view.dropped + overflow,
  };
}
