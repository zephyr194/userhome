import { DEFAULT_LOG_MAX_LINES } from "../../components/ui/logBuffer";
import type {
  CaddyAppliedState,
  CaddyApplyFailure,
  CaddyApplyReport,
  CaddyInstanceReview,
  CaddyLogPage,
  CaddyRunState,
} from "../../ipc/caddy";
import type { MessageKey } from "../../i18n";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

export const LOG_LINE_LIMIT = DEFAULT_LOG_MAX_LINES;

export interface RunStateView {
  label: string;
  symbol: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

interface RunStateSpec {
  labelKey: MessageKey;
  symbol: string;
  tone: RunStateView["tone"];
}

const RUN_STATE_VIEWS: Record<CaddyRunState, RunStateSpec> = {
  STOPPED: { labelKey: "caddy.run.state.stopped", symbol: "○", tone: "neutral" },
  STARTING: { labelKey: "caddy.run.state.starting", symbol: "◐", tone: "warning" },
  RUNNING: { labelKey: "caddy.run.state.running", symbol: "●", tone: "success" },
  STOPPING: { labelKey: "caddy.run.state.stopping", symbol: "◐", tone: "warning" },
  FAILED: { labelKey: "caddy.run.state.failed", symbol: "▲", tone: "danger" },
  UNKNOWN: { labelKey: "caddy.run.state.unknown", symbol: "◇", tone: "warning" },
};

export function presentRunState(state: CaddyRunState, copy: CaddyCopy = ZH_COPY): RunStateView {
  const spec = RUN_STATE_VIEWS[state];
  return { label: copy.t(spec.labelKey), symbol: spec.symbol, tone: spec.tone };
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

const APPLIED_VIEWS: Record<CaddyAppliedState, RunStateSpec> = {
  APPLIED: { labelKey: "caddy.run.applied.applied", symbol: "✓", tone: "success" },
  PENDING: { labelKey: "caddy.run.applied.pending", symbol: "△", tone: "warning" },
  UNKNOWN: { labelKey: "caddy.run.applied.unknown", symbol: "◇", tone: "warning" },
};

export function presentApplied(applied: CaddyAppliedState, copy: CaddyCopy = ZH_COPY): RunStateView {
  const spec = APPLIED_VIEWS[applied];
  return { label: copy.t(spec.labelKey), symbol: spec.symbol, tone: spec.tone };
}

export function canApply(
  state: CaddyRunState,
  applied: CaddyAppliedState | undefined,
  busy: boolean,
): boolean {
  return state === "RUNNING" && applied === "PENDING" && !busy;
}

const FAILURE_LABEL_KEYS: Record<CaddyApplyFailure, MessageKey> = {
  VALIDATION_FAILED: "caddy.run.failure.validation",
  PREPARATION_FAILED: "caddy.run.failure.preparation",
  COMMAND_FAILED: "caddy.run.failure.command",
  TIMEOUT: "caddy.run.failure.timeout",
  REVIEW_FAILED: "caddy.run.failure.review",
};

export function applyFailureLabel(failure: CaddyApplyFailure, copy: CaddyCopy = ZH_COPY): string {
  return copy.t(FAILURE_LABEL_KEYS[failure]);
}

const CONFIG_LABEL_KEYS: Record<CaddyInstanceReview["config"], MessageKey> = {
  PREVIOUS: "caddy.run.review.previousConfig",
  CANDIDATE: "caddy.run.review.candidateConfig",
  UNKNOWN: "caddy.run.review.unknownConfig",
};

export function reviewLines(review: CaddyInstanceReview, copy: CaddyCopy = ZH_COPY): string[] {
  return [
    copy.t(review.alive ? "caddy.run.review.alive" : "caddy.run.review.notAlive"),
    copy.t(review.adminReachable ? "caddy.run.review.adminReachable" : "caddy.run.review.adminUnreachable"),
    copy.t(CONFIG_LABEL_KEYS[review.config]),
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
