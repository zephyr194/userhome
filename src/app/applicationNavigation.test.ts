import { describe, expect, it } from "vitest";
import type { DiscoverySnapshot, UnmanagedCandidate } from "../ipc/discovery";
import {
  DEFAULT_APPLICATIONS_SCOPE,
  candidateIds,
  decodeApplicationsScope,
  resolveApplicationsNavigation,
} from "./applicationNavigation";

function candidateOf(candidateId: string): UnmanagedCandidate {
  return {
    candidateId,
    displayName: candidateId,
    rootKind: "HOME",
    relativePath: `~/${candidateId}`,
    entryType: "FILE",
    evidence: ["METADATA_PRESENT"],
    formatHints: [],
    sensitivityHint: "STANDARD",
    classificationReason: "test",
    name: candidateId,
    kind: "FILE",
    coverageClass: "DETECTED_UNSUPPORTED",
  };
}

function snapshotOf(
  refreshId: string,
  candidateList: readonly string[],
): DiscoverySnapshot {
  return {
    refreshId,
    startedAtEpochMs: 1,
    system: { status: "LOADING" },
    brew: { status: "LOADING" },
    candidates: {
      status: "READY",
      data: {
        completeness: "COMPLETE",
        candidates: candidateList.map(candidateOf),
        summary: {
          candidateCount: candidateList.length,
          metadataCount: candidateList.length,
          rootCount: 1,
          elapsedMs: 1,
          limits: {
            maxCandidates: 128,
            maxEntriesPerRoot: 128,
            maxMetadataCount: 128,
            maxRootDepth: 1,
            timeoutMs: 1500,
          },
          outcomes: [],
        },
        issues: [],
      },
    },
  };
}

describe("decodeApplicationsScope", () => {
  it("round-trips every known scope", () => {
    expect(decodeApplicationsScope("LOCAL_RECOGNIZED")).toBe(
      "LOCAL_RECOGNIZED",
    );
    expect(decodeApplicationsScope("CATALOG")).toBe("CATALOG");
  });

  it("falls back to the safe local scope for unknown values", () => {
    expect(DEFAULT_APPLICATIONS_SCOPE).toBe("LOCAL_RECOGNIZED");
    expect(decodeApplicationsScope("WAREHOUSE")).toBe(
      DEFAULT_APPLICATIONS_SCOPE,
    );
    expect(decodeApplicationsScope(undefined)).toBe(
      DEFAULT_APPLICATIONS_SCOPE,
    );
    expect(decodeApplicationsScope(42)).toBe(DEFAULT_APPLICATIONS_SCOPE);
  });
});

describe("candidateIds", () => {
  it("collects the candidate ids of a ready snapshot", () => {
    expect(candidateIds(snapshotOf("r1", ["a", "b"]))).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("returns undefined until candidates are ready", () => {
    const snapshot = snapshotOf("r1", ["a"]);
    expect(
      candidateIds({ ...snapshot, candidates: { status: "LOADING" } }),
    ).toBeUndefined();
    expect(candidateIds(undefined)).toBeUndefined();
  });
});

describe("resolveApplicationsNavigation", () => {
  it("treats catalog navigation as catalog scope and clears transient context", () => {
    const resolved = resolveApplicationsNavigation(
      { routeId: "applications", scope: "CATALOG", applicationId: "git" },
      snapshotOf("r1", ["c1"]),
    );

    expect(resolved.scope).toBe("CATALOG");
    expect(resolved.context).toBeUndefined();
    expect(resolved.stale).toBeUndefined();
  });

  it("treats an untyped applications intent as catalog navigation", () => {
    const resolved = resolveApplicationsNavigation(
      { routeId: "applications" },
      snapshotOf("r1", ["c1"]),
    );

    expect(resolved.scope).toBe("CATALOG");
    expect(resolved.context).toBeUndefined();
    expect(resolved.stale).toBeUndefined();
  });

  it("keeps a valid local candidate whose refresh snapshot matches", () => {
    const resolved = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: "c1",
        sourceRefreshId: "r1",
      },
      snapshotOf("r1", ["c1", "c2"]),
    );

    expect(resolved.scope).toBe("LOCAL_RECOGNIZED");
    expect(resolved.context).toEqual({
      candidateId: "c1",
      sourceRefreshId: "r1",
    });
    expect(resolved.stale).toBeUndefined();
  });

  it("infers local scope from a candidateId without an explicit scope", () => {
    const resolved = resolveApplicationsNavigation(
      { routeId: "applications", candidateId: "c2" },
      snapshotOf("r1", ["c1", "c2"]),
    );

    expect(resolved.scope).toBe("LOCAL_RECOGNIZED");
    expect(resolved.context).toEqual({
      candidateId: "c2",
      sourceRefreshId: "r1",
    });
    expect(resolved.stale).toBeUndefined();
  });

  it("binds an inferred candidate selection to the active refresh", () => {
    const first = resolveApplicationsNavigation(
      { routeId: "applications", candidateId: "c1" },
      snapshotOf("r1", ["c1"]),
    );
    const refreshed = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: first.context?.candidateId,
        sourceRefreshId: first.context?.sourceRefreshId,
      },
      snapshotOf("r2", ["c1"]),
    );

    expect(first.context?.sourceRefreshId).toBe("r1");
    expect(refreshed.context).toBeUndefined();
    expect(refreshed.stale?.reason).toBe("REFRESH_MISMATCH");
  });

  it("marks a mismatched source refresh as stale and drops the selection", () => {
    const resolved = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: "c1",
        sourceRefreshId: "r0",
      },
      snapshotOf("r1", ["c1"]),
    );

    expect(resolved.scope).toBe("LOCAL_RECOGNIZED");
    expect(resolved.context).toBeUndefined();
    expect(resolved.stale).toEqual({
      candidateId: "c1",
      sourceRefreshId: "r0",
      reason: "REFRESH_MISMATCH",
    });
  });

  it("marks a vanished candidate as stale", () => {
    const resolved = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: "gone",
        sourceRefreshId: "r1",
      },
      snapshotOf("r1", ["c1"]),
    );

    expect(resolved.context).toBeUndefined();
    expect(resolved.stale?.reason).toBe("CANDIDATE_MISSING");
  });

  it("marks local navigation stale when no snapshot is available", () => {
    const resolved = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: "c1",
        sourceRefreshId: "r1",
      },
      undefined,
    );

    expect(resolved.stale?.reason).toBe("SNAPSHOT_UNAVAILABLE");
  });

  it("accepts a plain local list navigation without a candidate", () => {
    const resolved = resolveApplicationsNavigation(
      { routeId: "applications", scope: "LOCAL_RECOGNIZED" },
      undefined,
    );

    expect(resolved.scope).toBe("LOCAL_RECOGNIZED");
    expect(resolved.context).toBeUndefined();
    expect(resolved.stale).toBeUndefined();
  });
});
