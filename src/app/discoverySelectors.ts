import type {
  CandidateScanOutcome,
  CandidateScanOutcomeKind,
  CandidateScanSummary,
  ConfigurationCoverage,
  DiscoveryCompleteness,
  DiscoveryIssue,
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../ipc/discovery";

export type CandidateCoverageStatus =
  | "loading"
  | "error"
  | "empty"
  | "complete"
  | "partial";

export interface CandidateCoverageCounts {
  managedWritable: number;
  managedReadOnly: number;
  detectedUnsupported: number;
  excluded: number;
  total: number;
}

export interface CandidateCoverageView {
  status: CandidateCoverageStatus;
  completeness?: DiscoveryCompleteness;
  counts: CandidateCoverageCounts;
  candidates: readonly UnmanagedCandidate[];
  summary?: CandidateScanSummary;
  outcomes: readonly CandidateScanOutcome[];
  issues: readonly DiscoveryIssue[];
  restricted: boolean;
  conservesTotals: boolean;
}

/**
 * Compatibility view of a candidates module. New snapshots carry the full
 * `ConfigurationCoverage`; the legacy IPC shape was a bare candidate array.
 */
export type CandidateModule =
  | ModuleSnapshot<ConfigurationCoverage>
  | ModuleSnapshot<readonly UnmanagedCandidate[]>;

/**
 * Outcomes that mean the scan could not fully explore the approved roots, so
 * results are present but restricted (permission, disabled root, timeout,
 * unavailable metadata, or a reached count/entry/metadata limit).
 */
const RESTRICTING_OUTCOMES: ReadonlySet<CandidateScanOutcomeKind> = new Set<
  CandidateScanOutcomeKind
>([
  "PERMISSION_DENIED",
  "INVALID_ROOT",
  "METADATA_UNAVAILABLE",
  "TIMEOUT",
  "CANDIDATE_LIMIT_REACHED",
  "ENTRY_LIMIT_REACHED",
  "METADATA_LIMIT_REACHED",
]);

function emptyCounts(): CandidateCoverageCounts {
  return {
    managedWritable: 0,
    managedReadOnly: 0,
    detectedUnsupported: 0,
    excluded: 0,
    total: 0,
  };
}

function emptyView(status: CandidateCoverageStatus): CandidateCoverageView {
  return {
    status,
    counts: emptyCounts(),
    candidates: [],
    outcomes: [],
    issues: [],
    restricted: false,
    conservesTotals: true,
  };
}

export function countCoverageClasses(
  candidates: readonly UnmanagedCandidate[],
): CandidateCoverageCounts {
  const counts = emptyCounts();
  for (const candidate of candidates) {
    switch (candidate.coverageClass) {
      case "MANAGED_WRITABLE":
        counts.managedWritable += 1;
        break;
      case "MANAGED_READ_ONLY":
        counts.managedReadOnly += 1;
        break;
      case "EXCLUDED":
        counts.excluded += 1;
        break;
      default:
        counts.detectedUnsupported += 1;
        break;
    }
    counts.total += 1;
  }
  return counts;
}

export function selectCandidateCoverage(
  module: ModuleSnapshot<ConfigurationCoverage> | undefined,
): CandidateCoverageView {
  if (!module || module.status === "LOADING") {
    return emptyView("loading");
  }
  if (module.status === "ERROR") {
    return emptyView("error");
  }
  const { data } = module;
  const counts = countCoverageClasses(data.candidates);
  const status: CandidateCoverageStatus =
    data.completeness === "PARTIAL"
      ? "partial"
      : data.candidates.length === 0
        ? "empty"
        : "complete";
  return {
    status,
    completeness: data.completeness,
    counts,
    candidates: data.candidates,
    summary: data.summary,
    outcomes: data.summary.outcomes,
    issues: data.issues,
    restricted: data.summary.outcomes.some((outcome) =>
      RESTRICTING_OUTCOMES.has(outcome.kind),
    ),
    conservesTotals: counts.total === data.summary.candidateCount,
  };
}

export function selectCandidateListModule(
  module: ModuleSnapshot<ConfigurationCoverage> | undefined,
): ModuleSnapshot<readonly UnmanagedCandidate[]> {
  if (!module || module.status === "LOADING") {
    return { status: "LOADING" };
  }
  if (module.status === "ERROR") {
    return { status: "ERROR", error: module.error };
  }
  return { status: "READY", data: module.data.candidates };
}

function isConfigurationCoverage(
  data: ConfigurationCoverage | readonly UnmanagedCandidate[],
): data is ConfigurationCoverage {
  return !Array.isArray(data);
}

export function candidatesFromModule(
  module: CandidateModule,
): readonly UnmanagedCandidate[] {
  if (module.status !== "READY") {
    return [];
  }
  return isConfigurationCoverage(module.data) ? module.data.candidates : module.data;
}
