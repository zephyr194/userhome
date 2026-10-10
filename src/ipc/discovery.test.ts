import { describe, expect, it } from "vitest";
import { decodeDiscoverySnapshot } from "./discovery";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    displayName: ".config/git/config",
    rootKind: "HOME",
    relativePath: "~/.config/git/config",
    entryType: "FILE",
    evidence: ["CATALOG_DOCUMENT"],
    formatHints: ["GIT_CONFIG"],
    sensitivityHint: "SENSITIVE",
    classificationReason: "Managed by catalog.",
    name: ".config/git/config",
    kind: "FILE",
    coverageClass: "MANAGED_WRITABLE",
    catalogAppId: "git",
    ...overrides,
  };
}

const scanLimits = {
  maxCandidates: 128,
  maxEntriesPerRoot: 64,
  maxMetadataCount: 512,
  maxRootDepth: 2,
  timeoutMs: 1_500,
};

function snapshotWith(candidatesModule: unknown) {
  return decodeDiscoverySnapshot({
    refreshId: "refresh-1",
    startedAtEpochMs: 10,
    completedAtEpochMs: 20,
    system: { status: "LOADING" },
    brew: { status: "LOADING" },
    candidates: candidatesModule,
  });
}

describe("discovery candidate decoding", () => {
  it("preserves the complete configuration coverage summary and outcomes", () => {
    const snapshot = snapshotWith({
      status: "READY",
      data: {
        completeness: "PARTIAL",
        candidates: [
          candidate(),
          candidate({
            candidateId: "candidate-2",
            displayName: ".config/tool/state",
            relativePath: "~/.config/tool/state",
            entryType: "DIRECTORY",
            name: ".config/tool/state",
            kind: "DIRECTORY",
            sensitivityHint: "UNKNOWN",
            coverageClass: "DETECTED_UNSUPPORTED",
            catalogAppId: undefined,
          }),
        ],
        summary: {
          candidateCount: 2,
          metadataCount: 5,
          rootCount: 3,
          elapsedMs: 42,
          limits: scanLimits,
          outcomes: [
            {
              kind: "PERMISSION_DENIED",
              message: "Permission denied for a bounded root.",
              retryable: true,
            },
            {
              kind: "TIMEOUT",
              message: "Metadata scan hit the time budget.",
              retryable: true,
            },
            {
              kind: "CANDIDATE_LIMIT_REACHED",
              message: "Candidate limit reached.",
              retryable: false,
            },
            {
              kind: "SYMLINK_METADATA_ONLY",
              message: "Symlink inspected as metadata only.",
              retryable: false,
            },
          ],
        },
        issues: [
          {
            module: "candidates",
            message: "One root was not readable.",
            retryable: true,
          },
        ],
      },
    });

    if (snapshot.candidates.status !== "READY") {
      throw new Error("candidate coverage should decode as ready");
    }

    expect(snapshot.candidates.data.completeness).toBe("PARTIAL");
    expect(snapshot.candidates.data.summary).toEqual({
      candidateCount: 2,
      metadataCount: 5,
      rootCount: 3,
      elapsedMs: 42,
      limits: scanLimits,
      outcomes: [
        {
          kind: "PERMISSION_DENIED",
          message: "Permission denied for a bounded root.",
          retryable: true,
        },
        {
          kind: "TIMEOUT",
          message: "Metadata scan hit the time budget.",
          retryable: true,
        },
        {
          kind: "CANDIDATE_LIMIT_REACHED",
          message: "Candidate limit reached.",
          retryable: false,
        },
        {
          kind: "SYMLINK_METADATA_ONLY",
          message: "Symlink inspected as metadata only.",
          retryable: false,
        },
      ],
    });
    expect(snapshot.candidates.data.issues).toEqual([
      {
        module: "candidates",
        message: "One root was not readable.",
        retryable: true,
      },
    ]);
    expect(snapshot.candidates.data.candidates).toHaveLength(2);
    expect(snapshot.candidates.data.candidates[0].coverageClass).toBe(
      "MANAGED_WRITABLE",
    );
  });

  it("keeps the legacy candidate array compatible with a synthesized summary", () => {
    const snapshot = snapshotWith({
      status: "READY",
      data: [candidate()],
    });

    if (snapshot.candidates.status !== "READY") {
      throw new Error("legacy candidate array should decode as ready");
    }

    expect(snapshot.candidates.data.candidates).toHaveLength(1);
    expect(snapshot.candidates.data.completeness).toBe("COMPLETE");
    expect(snapshot.candidates.data.summary.candidateCount).toBe(1);
    expect(snapshot.candidates.data.summary.outcomes).toEqual([]);
  });

  it("keeps a candidates module failure isolated", () => {
    const snapshot = snapshotWith({
      status: "ERROR",
      error: {
        module: "candidates",
        message: "Candidate scan failed.",
        retryable: true,
      },
    });

    expect(snapshot.candidates).toEqual({
      status: "ERROR",
      error: {
        module: "candidates",
        message: "Candidate scan failed.",
        retryable: true,
      },
    });
  });

  it("rejects a summary whose candidate count disagrees with the payload", () => {
    expect(() =>
      snapshotWith({
        status: "READY",
        data: {
          completeness: "COMPLETE",
          candidates: [candidate()],
          summary: {
            candidateCount: 3,
            metadataCount: 3,
            rootCount: 1,
            elapsedMs: 1,
            limits: scanLimits,
            outcomes: [],
          },
          issues: [],
        },
      }),
    ).toThrow();
  });
});
