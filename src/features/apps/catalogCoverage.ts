import type { ManagedAppCatalog } from "../../ipc/catalog";
import type { SanitizedBaselineManifest } from "../../ipc/discovery";

export interface CatalogCoverageMetrics {
  classifiedCandidateCount: number;
  totalCandidateCount: number;
  excludedCandidateCount: number;
  omittedCandidateCount: number;
  eligibleTextCount: number;
  managedEligibleTextCount: number;
  eligibleTextPercent: number;
  meetsEligibleTextTarget: boolean;
  priorityAComplete: boolean;
  priorityBComplete: boolean;
  complete: boolean;
}

export function summarizeCatalogCoverage(
  catalog: ManagedAppCatalog,
  manifest: SanitizedBaselineManifest,
): CatalogCoverageMetrics {
  const coverage = manifest.coverage;
  const classifiedCandidateCount =
    coverage.managedWritableCount +
    coverage.managedReadOnlyCount +
    coverage.unsupportedCount +
    coverage.excludedCount;
  const eligibleTextCount = coverage.eligibleTextCount;
  const managedEligibleTextCount = coverage.managedEligibleTextCount;
  const eligibleTextPercent =
    eligibleTextCount === 0
      ? 100
      : (managedEligibleTextCount / eligibleTextCount) * 100;
  const priorityAComplete =
    catalog.coveragePolicy.priorityAUsable ===
    catalog.coveragePolicy.priorityATotal;
  const priorityBComplete =
    catalog.coveragePolicy.priorityBCovered ===
    catalog.coveragePolicy.priorityBTotal;
  const meetsEligibleTextTarget =
    eligibleTextPercent >=
    catalog.coveragePolicy.minimumEligibleTextPercent;

  return {
    classifiedCandidateCount,
    totalCandidateCount: coverage.totalCandidateCount,
    excludedCandidateCount: coverage.excludedCount,
    omittedCandidateCount: coverage.omittedCandidateCount,
    eligibleTextCount,
    managedEligibleTextCount,
    eligibleTextPercent,
    meetsEligibleTextTarget,
    priorityAComplete,
    priorityBComplete,
    complete:
      classifiedCandidateCount === coverage.totalCandidateCount &&
      priorityAComplete &&
      priorityBComplete &&
      meetsEligibleTextTarget,
  };
}
