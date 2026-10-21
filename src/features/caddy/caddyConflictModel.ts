import type { NavigationIntent } from "../../app/routeDefinitions";
import type {
  CaddyConflictReport,
  CaddyConflictVerdict,
  CaddyExternalDomain,
  CaddyExternalRunState,
  CaddyPortState,
  CaddySnapshotStatus,
  CaddyStartSummary,
  CaddyUpstreamState,
} from "../../ipc/caddy";

export interface VerdictPresentation {
  symbol: string;
  label: string;
}

const VERDICTS: Record<CaddyConflictVerdict, VerdictPresentation> = {
  CLEAR: { symbol: "✓", label: "未发现冲突" },
  UNCONFIRMED: { symbol: "!", label: "需要确认" },
  BLOCKED: { symbol: "✕", label: "发现冲突" },
};

export function presentVerdict(verdict: CaddyConflictVerdict): VerdictPresentation {
  return VERDICTS[verdict];
}

export const SNAPSHOT_LABELS: Record<CaddySnapshotStatus, string> = {
  COMPLETE: "快照完整",
  INCOMPLETE: "快照不完整",
  UNREADABLE: "快照无法读取",
};

export const DOMAIN_LABELS: Record<CaddyExternalDomain, string> = {
  GUI: "用户域",
  SYSTEM: "系统域",
};

export const RUN_STATE_LABELS: Record<CaddyExternalRunState, string> = {
  RUNNING: "● 运行中",
  NOT_RUNNING: "○ 未运行",
  UNKNOWN: "? 状态未知",
  INACCESSIBLE: "? 无法访问",
};

export const PORT_STATE_LABELS: Record<CaddyPortState, string> = {
  FREE: "✓ 未发现占用",
  OCCUPIED: "✕ 已占用",
  UNCHECKED: "! 未检查",
};

export const UPSTREAM_STATE_LABELS: Record<CaddyUpstreamState, string> = {
  REACHABLE: "✓ 可连接",
  UNREACHABLE: "! 不可达（仅提示）",
  UNCHECKED: "! 未检查（仅提示）",
};

export interface StartGate {
  canStart: boolean;
  acceptUnconfirmed: boolean;
}

const CLOSED: StartGate = { canStart: false, acceptUnconfirmed: false };

/**
 * The button state only. The backend makes the same decision again at start,
 * so a stale or forged enabled button cannot start a conflicting instance.
 */
export function startGate(summary: CaddyStartSummary, accepted: boolean): StartGate {
  if (summary.planId === undefined || summary.blocked !== undefined) return CLOSED;
  const verdict = summary.conflicts?.verdict;
  if (verdict === undefined || verdict === "CLEAR") {
    return { canStart: true, acceptUnconfirmed: false };
  }
  if (verdict === "UNCONFIRMED") {
    return { canStart: accepted, acceptUnconfirmed: accepted };
  }
  return CLOSED;
}

export interface ServiceTarget {
  label: string;
  domain: CaddyExternalDomain;
}

/** Navigation only: the services page selects the named task and performs no action. */
export function serviceFocusIntent(target: ServiceTarget): NavigationIntent {
  return {
    routeId: "services",
    serviceFocus: { label: target.label, domain: target.domain },
    source: "content",
  };
}

/** Only a running external instance that actually blocks offers a jump; nothing is changed by it. */
export function externalServiceTargets(
  report: CaddyConflictReport | undefined,
): ServiceTarget[] {
  if (report === undefined || !report.blocks.includes("EXTERNAL_RUNNING")) return [];
  const seen = new Set<string>();
  const targets: ServiceTarget[] = [];
  for (const instance of report.external.instances) {
    if (instance.runState !== "RUNNING") continue;
    const key = `${instance.domain}/${instance.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ label: instance.label, domain: instance.domain });
  }
  return targets;
}
