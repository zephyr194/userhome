import type { DiscoverySnapshot } from "../ipc/discovery";
import type {
  ApplicationsNavigationIntent,
  ApplicationsScope,
} from "./routeDefinitions";
import type { DiscoveryState } from "./shellState";

/**
 * The local candidate list is the safe default: it never requires a catalog
 * entry and degrades gracefully when discovery data is unavailable.
 */
export const DEFAULT_APPLICATIONS_SCOPE: ApplicationsScope =
  "LOCAL_RECOGNIZED";

export function isApplicationsScope(
  value: unknown,
): value is ApplicationsScope {
  return value === "LOCAL_RECOGNIZED" || value === "CATALOG";
}

export function decodeApplicationsScope(value: unknown): ApplicationsScope {
  return isApplicationsScope(value) ? value : DEFAULT_APPLICATIONS_SCOPE;
}

/**
 * The snapshot the applications workspace should validate local navigation
 * against: the ready snapshot, or the last good snapshot of a failed refresh.
 */
export function activeDiscoverySnapshot(
  discovery: DiscoveryState,
): DiscoverySnapshot | undefined {
  if (discovery.status === "ready") {
    return discovery.snapshot;
  }
  if (discovery.status === "error") {
    return discovery.previousSnapshot;
  }
  return undefined;
}

/**
 * Candidate ids of a snapshot, or `undefined` when the candidates module has
 * not loaded yet (so callers can distinguish "unknown" from "absent").
 */
export function candidateIds(
  snapshot: DiscoverySnapshot | undefined,
): ReadonlySet<string> | undefined {
  const module = snapshot?.candidates;
  if (!module || module.status !== "READY") {
    return undefined;
  }
  const data = module.data;
  const candidates = Array.isArray(data) ? data : data.candidates;
  return new Set(candidates.map((candidate) => candidate.candidateId));
}

/** Format of the selection key the applications workspace uses for a candidate. */
export function candidateSelectionKey(candidateId: string): string {
  return `candidate:${candidateId}`;
}

export type StaleApplicationReason =
  | "SNAPSHOT_UNAVAILABLE"
  | "REFRESH_MISMATCH"
  | "CANDIDATE_MISSING";

/**
 * Transient, session-only navigation details. These are never persisted in
 * selection memory; they only live while the AppShell session is alive.
 */
export interface ApplicationNavigationContext {
  candidateId?: string;
  sourceRefreshId?: string;
}

export interface StaleApplicationNavigation {
  candidateId?: string;
  sourceRefreshId?: string;
  reason: StaleApplicationReason;
}

export interface ResolvedApplicationsNavigation {
  scope: ApplicationsScope;
  /** Present only when the local candidate was validated against a snapshot. */
  context?: ApplicationNavigationContext;
  /** Present when a requested local candidate could not be validated. */
  stale?: StaleApplicationNavigation;
}

/**
 * Decides how an applications navigation intent maps onto the workspace.
 *
 * Catalog intents (explicit `CATALOG`, or a bare applications intent) always
 * resolve to `CATALOG` with no transient context, clearing any previous local
 * selection.
 *
 * Local intents (`LOCAL_RECOGNIZED`, or any intent carrying a `candidateId`)
 * are validated against the active discovery snapshot. A valid candidate is
 * forwarded as transient context; a stale or vanished candidate is dropped so
 * no ghost selection is produced, while the local scope is retained.
 */
export function resolveApplicationsNavigation(
  intent: ApplicationsNavigationIntent,
  snapshot: DiscoverySnapshot | undefined,
): ResolvedApplicationsNavigation {
  const wantsLocal =
    intent.scope === "LOCAL_RECOGNIZED" || intent.candidateId !== undefined;

  if (!wantsLocal) {
    return { scope: "CATALOG" };
  }

  const { candidateId, sourceRefreshId } = intent;

  if (!snapshot) {
    return candidateId !== undefined
      ? {
          scope: "LOCAL_RECOGNIZED",
          stale: {
            ...(candidateId !== undefined ? { candidateId } : {}),
            ...(sourceRefreshId !== undefined ? { sourceRefreshId } : {}),
            reason: "SNAPSHOT_UNAVAILABLE",
          },
        }
      : { scope: "LOCAL_RECOGNIZED" };
  }

  if (
    sourceRefreshId !== undefined &&
    sourceRefreshId !== snapshot.refreshId
  ) {
    return {
      scope: "LOCAL_RECOGNIZED",
      stale: {
        ...(candidateId !== undefined ? { candidateId } : {}),
        sourceRefreshId,
        reason: "REFRESH_MISMATCH",
      },
    };
  }

  if (candidateId !== undefined) {
    const ids = candidateIds(snapshot);
    if (!ids || !ids.has(candidateId)) {
      return {
        scope: "LOCAL_RECOGNIZED",
        stale: {
          candidateId,
          ...(sourceRefreshId !== undefined ? { sourceRefreshId } : {}),
          reason: "CANDIDATE_MISSING",
        },
      };
    }
  }

  return {
    scope: "LOCAL_RECOGNIZED",
    ...(candidateId !== undefined
      ? {
          context: {
            candidateId,
            sourceRefreshId: snapshot.refreshId,
          },
        }
      : {}),
  };
}
