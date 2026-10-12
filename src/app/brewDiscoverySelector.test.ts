import { describe, expect, it } from "vitest";
import type { AppError } from "../ipc/core";
import type {
  BrewInventorySummary,
  DiscoverySnapshot,
} from "../ipc/discovery";
import type { DiscoveryState } from "./shellState";
import { selectBrewSummary } from "./brewDiscoverySelector";

const error: AppError = {
  code: "INTERNAL",
  message: "本地服务暂时不可用。",
  retryable: true,
};

const brewReady: BrewInventorySummary = {
  available: true,
  prefix: "/opt/homebrew",
  version: "4.0.0",
  formulaCount: 12,
  caskCount: 4,
};

function snapshot(refreshId: string): DiscoverySnapshot {
  return {
    refreshId,
    startedAtEpochMs: 1,
    system: { status: "LOADING" },
    brew: { status: "READY", data: brewReady },
    candidates: { status: "LOADING" },
  };
}

describe("selectBrewSummary", () => {
  it("maps discovery loading to a transient loading view", () => {
    expect(selectBrewSummary({ status: "loading" })).toEqual({
      status: "loading",
    });
  });

  it("returns the real brew module and refresh id when discovery is ready", () => {
    const view = selectBrewSummary({
      status: "ready",
      snapshot: snapshot("refresh-1"),
    });

    expect(view.status).toBe("ready");
    if (view.status !== "ready") throw new Error("ready expected");
    expect(view.module).toEqual({ status: "READY", data: brewReady });
    expect(view.refreshId).toBe("refresh-1");
  });

  it("returns the retained brew module with stale/error metadata after a failed refresh", () => {
    const view = selectBrewSummary({
      status: "error",
      error,
      previousSnapshot: snapshot("refresh-1"),
    });

    expect(view.status).toBe("stale");
    if (view.status !== "stale") throw new Error("stale expected");
    expect(view.module).toEqual({ status: "READY", data: brewReady });
    expect(view.refreshId).toBe("refresh-1");
    expect(view.error).toEqual(error);
  });

  it("keeps the exact retained module reference so old data never disappears", () => {
    const previousSnapshot = snapshot("refresh-1");
    previousSnapshot.brew = { status: "READY", data: { ...brewReady, formulaCount: 12 } };

    const view = selectBrewSummary({ status: "error", error, previousSnapshot });

    expect(view.status).toBe("stale");
    if (view.status !== "stale") throw new Error("stale expected");
    expect(view.module).toBe(previousSnapshot.brew);
  });

  it("reports a hard error when a refresh fails before any snapshot exists", () => {
    const view = selectBrewSummary({ status: "error", error });

    expect(view.status).toBe("error");
    if (view.status !== "error") throw new Error("error expected");
    expect(view.error).toEqual(error);
  });

  it("never strands the brew view in loading on any terminal discovery state", () => {
    const terminalStates: DiscoveryState[] = [
      { status: "ready", snapshot: snapshot("refresh-1") },
      { status: "error", error },
      { status: "error", error, previousSnapshot: snapshot("refresh-1") },
    ];

    for (const state of terminalStates) {
      expect(selectBrewSummary(state).status).not.toBe("loading");
    }
  });
});
