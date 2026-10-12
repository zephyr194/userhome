import type { AppError } from "../ipc/core";
import type {
  BrewInventorySummary,
  ModuleSnapshot,
} from "../ipc/discovery";
import type { DiscoveryState } from "./shellState";

/**
 * Selector output for the Homebrew provider inside the discovery state.
 *
 * The four cases mirror the discovery lifecycle so consumers (routes) can
 * render real data, retained data, or a hard failure without ever stranding
 * the provider on a perpetual loading state:
 *
 * - `loading`: discovery is still gathering its first snapshot. Transient only;
 *   a terminal discovery state never yields it.
 * - `ready`: the live snapshot's brew module and its refresh id.
 * - `stale`: the latest refresh failed, but a previous snapshot survives. The
 *   retained brew module (with any old data still inside it) is returned with
 *   the failure attached, so old data stays visible and flagged.
 * - `error`: the refresh failed before any snapshot existed. There is nothing
 *   to show, so only the error is surfaced.
 */
export type BrewSummaryView =
  | { status: "loading" }
  | {
      status: "ready";
      module: ModuleSnapshot<BrewInventorySummary>;
      refreshId: string;
    }
  | {
      status: "stale";
      module: ModuleSnapshot<BrewInventorySummary>;
      refreshId: string;
      error: AppError;
    }
  | { status: "error"; error: AppError };

export function selectBrewSummary(discovery: DiscoveryState): BrewSummaryView {
  switch (discovery.status) {
    case "loading":
      return { status: "loading" };
    case "ready":
      return {
        status: "ready",
        module: discovery.snapshot.brew,
        refreshId: discovery.snapshot.refreshId,
      };
    case "error":
      if (discovery.previousSnapshot) {
        return {
          status: "stale",
          module: discovery.previousSnapshot.brew,
          refreshId: discovery.previousSnapshot.refreshId,
          error: discovery.error,
        };
      }
      return { status: "error", error: discovery.error };
  }
}
