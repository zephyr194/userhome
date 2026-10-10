import { describe, expect, it } from "vitest";
import type {
  CandidateScanOutcome,
  ConfigurationCoverage,
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../ipc/discovery";
import {
  selectCandidateCoverage,
  selectCandidateListModule,
} from "./discoverySelectors";

function candidate(
  candidateId: string,
  coverageClass: UnmanagedCandidate["coverageClass"],
): UnmanagedCandidate {
  return {
    candidateId,
    displayName: candidateId,
    rootKind: "HOME",
    relativePath: `~/${candidateId}`,
    entryType: "FILE",
    evidence: ["BOUNDED_ROOT_ENTRY"],
    formatHints: [],
    sensitivityHint: "UNKNOWN",
    classificationReason: "Bounded metadata discovery.",
    name: candidateId,
    kind: "FILE",
    coverageClass,
  };
}

function coverage(
  overrides: Partial<ConfigurationCoverage> = {},
): ConfigurationCoverage {
  return {
    completeness: "COMPLETE",
    candidates: [],
    summary: {
      candidateCount: 0,
      metadataCount: 0,
      rootCount: 1,
      elapsedMs: 5,
      limits: {
        maxCandidates: 128,
        maxEntriesPerRoot: 64,
        maxMetadataCount: 512,
        maxRootDepth: 1,
        timeoutMs: 1_500,
      },
      outcomes: [],
    },
    issues: [],
    ...overrides,
  };
}

function ready(
  value: ConfigurationCoverage,
): ModuleSnapshot<ConfigurationCoverage> {
  return { status: "READY", data: value };
}

describe("selectCandidateCoverage", () => {
  it("counts the four coverage classes and conserves the candidate total", () => {
    const data = coverage({
      candidates: [
        candidate("managed-writable", "MANAGED_WRITABLE"),
        candidate("managed-read-only", "MANAGED_READ_ONLY"),
        candidate("unsupported", "DETECTED_UNSUPPORTED"),
        candidate("excluded", "EXCLUDED"),
      ],
      summary: {
        ...coverage().summary,
        candidateCount: 4,
        metadataCount: 4,
      },
    });

    const view = selectCandidateCoverage(ready(data));

    expect(view.counts).toEqual({
      managedWritable: 1,
      managedReadOnly: 1,
      detectedUnsupported: 1,
      excluded: 1,
      total: 4,
    });
    expect(view.counts.total).toBe(data.summary.candidateCount);
    expect(view.conservesTotals).toBe(true);
    expect(view.status).toBe("complete");
    expect(view.candidates).toHaveLength(4);
  });

  it("flags a complete scan with zero candidates as empty", () => {
    const view = selectCandidateCoverage(ready(coverage()));

    expect(view.status).toBe("empty");
    expect(view.counts.total).toBe(0);
    expect(view.conservesTotals).toBe(true);
  });

  it("keeps partial results visible with their scan outcomes", () => {
    const outcome: CandidateScanOutcome = {
      kind: "PERMISSION_DENIED",
      message: "A bounded root was not readable.",
      retryable: true,
    };
    const data = coverage({
      completeness: "PARTIAL",
      candidates: [
        candidate("managed-writable", "MANAGED_WRITABLE"),
        candidate("unsupported", "DETECTED_UNSUPPORTED"),
      ],
      summary: {
        ...coverage().summary,
        candidateCount: 2,
        metadataCount: 2,
        outcomes: [outcome],
      },
      issues: [
        { module: "candidates", message: "Partial scan.", retryable: true },
      ],
    });

    const view = selectCandidateCoverage(ready(data));

    expect(view.status).toBe("partial");
    expect(view.candidates).toHaveLength(2);
    expect(view.counts).toMatchObject({
      managedWritable: 1,
      detectedUnsupported: 1,
      total: 2,
    });
    expect(view.outcomes).toEqual([outcome]);
    expect(view.issues).toHaveLength(1);
    expect(view.restricted).toBe(true);
  });

  it("reports loading and error modules without inventing counts", () => {
    const loading = selectCandidateCoverage({ status: "LOADING" });
    const error = selectCandidateCoverage({
      status: "ERROR",
      error: { module: "candidates", message: "failed", retryable: true },
    });

    expect(loading.status).toBe("loading");
    expect(loading.counts.total).toBe(0);
    expect(error.status).toBe("error");
    expect(error.restricted).toBe(false);
    expect(error.outcomes).toEqual([]);
  });

  it("does not mark an unrestricted complete scan as restricted", () => {
    const view = selectCandidateCoverage(
      ready(
        coverage({
          candidates: [candidate("managed", "MANAGED_WRITABLE")],
          summary: { ...coverage().summary, candidateCount: 1, metadataCount: 1 },
        }),
      ),
    );

    expect(view.status).toBe("complete");
    expect(view.restricted).toBe(false);
  });

  it("detects when the summary total disagrees with the payload", () => {
    const view = selectCandidateCoverage(
      ready(
        coverage({
          candidates: [candidate("only-one", "MANAGED_WRITABLE")],
          summary: { ...coverage().summary, candidateCount: 7, metadataCount: 7 },
        }),
      ),
    );

    expect(view.counts.total).toBe(1);
    expect(view.conservesTotals).toBe(false);
  });
});

describe("selectCandidateListModule", () => {
  it("reduces full coverage to the candidate list while keeping status", () => {
    const module = ready(
      coverage({
        candidates: [candidate("managed", "MANAGED_WRITABLE")],
        summary: { ...coverage().summary, candidateCount: 1, metadataCount: 1 },
      }),
    );

    const list = selectCandidateListModule(module);

    expect(list.status).toBe("READY");
    if (list.status !== "READY") throw new Error("ready expected");
    expect(list.data).toHaveLength(1);
    expect(list.data[0].candidateId).toBe("managed");
  });

  it("passes loading and error through unchanged", () => {
    expect(selectCandidateListModule(undefined)).toEqual({ status: "LOADING" });
    expect(
      selectCandidateListModule({
        status: "ERROR",
        error: { module: "candidates", message: "failed", retryable: false },
      }),
    ).toEqual({
      status: "ERROR",
      error: { module: "candidates", message: "failed", retryable: false },
    });
  });
});
