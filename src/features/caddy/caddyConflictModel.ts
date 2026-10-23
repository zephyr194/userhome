import type { NavigationIntent } from "../../app/routeDefinitions";
import type { MessageKey } from "../../i18n";
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
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

export interface VerdictPresentation {
  symbol: string;
  label: string;
}

const VERDICTS: Record<CaddyConflictVerdict, { symbol: string; labelKey: MessageKey }> = {
  CLEAR: { symbol: "✓", labelKey: "caddy.conflict.verdict.clear" },
  UNCONFIRMED: { symbol: "!", labelKey: "caddy.conflict.verdict.unconfirmed" },
  BLOCKED: { symbol: "✕", labelKey: "caddy.conflict.verdict.blocked" },
};

export function presentVerdict(
  verdict: CaddyConflictVerdict,
  copy: CaddyCopy = ZH_COPY,
): VerdictPresentation {
  const entry = VERDICTS[verdict];
  return { symbol: entry.symbol, label: copy.t(entry.labelKey) };
}

export const SNAPSHOT_LABEL_KEYS: Record<CaddySnapshotStatus, MessageKey> = {
  COMPLETE: "caddy.conflict.snapshot.complete",
  INCOMPLETE: "caddy.conflict.snapshot.incomplete",
  UNREADABLE: "caddy.conflict.snapshot.unreadable",
};

export const DOMAIN_LABEL_KEYS: Record<CaddyExternalDomain, MessageKey> = {
  GUI: "caddy.conflict.domain.gui",
  SYSTEM: "caddy.conflict.domain.system",
};

export const RUN_STATE_LABEL_KEYS: Record<CaddyExternalRunState, MessageKey> = {
  RUNNING: "caddy.conflict.runState.running",
  NOT_RUNNING: "caddy.conflict.runState.notRunning",
  UNKNOWN: "caddy.conflict.runState.unknown",
  INACCESSIBLE: "caddy.conflict.runState.inaccessible",
};

export const PORT_STATE_LABEL_KEYS: Record<CaddyPortState, MessageKey> = {
  FREE: "caddy.conflict.port.free",
  OCCUPIED: "caddy.conflict.port.occupied",
  UNCHECKED: "caddy.conflict.port.unchecked",
};

export const UPSTREAM_STATE_LABEL_KEYS: Record<CaddyUpstreamState, MessageKey> = {
  REACHABLE: "caddy.conflict.upstream.reachable",
  UNREACHABLE: "caddy.conflict.upstream.unreachable",
  UNCHECKED: "caddy.conflict.upstream.unchecked",
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
