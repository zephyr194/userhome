import { createInternalError, invokeCommand, isRecord } from "./core";
import type { ManagedAppCoverageClass } from "./catalog";
import { decodeSafeDisplayPath } from "./config";

const MAX_TEXT_BYTES = 2 * 1024;
const MAX_APPLICATIONS = 32;
const MAX_EVIDENCE = 32;
const MAX_ISSUES = 32;
const MAX_CANDIDATES = 128;
const MAX_CANDIDATE_EVIDENCE = 8;
const MAX_FORMAT_HINTS = 8;
const MAX_SCAN_OUTCOMES = 32;
const CANDIDATE_KINDS = [
  "FILE",
  "DIRECTORY",
  "SYMLINK",
  "SOCKET",
  "OTHER",
] as const;
const CANDIDATE_ROOT_KINDS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPLICATION_SUPPORT",
  "HOMEBREW_PREFIX",
  "APP_SUPPORT",
] as const;
const CANDIDATE_EVIDENCE_KINDS = [
  "METADATA_PRESENT",
  "CATALOG_DOCUMENT",
  "CATALOG_SERVICE",
  "BOUNDED_ROOT_ENTRY",
  "SYMLINK_METADATA_ONLY",
  "EXCLUSION_RULE",
] as const;
const CANDIDATE_SENSITIVITY_HINTS = [
  "STANDARD",
  "SENSITIVE",
  "SECRET",
  "UNKNOWN",
] as const;
const CANDIDATE_SCAN_OUTCOME_KINDS = [
  "COMPLETE",
  "CANDIDATE_LIMIT_REACHED",
  "ENTRY_LIMIT_REACHED",
  "METADATA_LIMIT_REACHED",
  "PERMISSION_DENIED",
  "SYMLINK_METADATA_ONLY",
  "TIMEOUT",
  "METADATA_UNAVAILABLE",
  "INVALID_ROOT",
] as const;

export type ModuleStatus = "LOADING" | "READY" | "ERROR";
export type DiscoveryCompleteness = "COMPLETE" | "PARTIAL";
export type DetectionStatus = "DETECTED" | "PARTIAL" | "ABSENT";
export type EvidenceKind = "CONFIG_PRESENT" | "EXECUTABLE_PRESENT";
export type PathEntryKind = "FILE" | "DIRECTORY" | "SYMLINK" | "OTHER";
export type CandidateKind =
  | "FILE"
  | "DIRECTORY"
  | "SYMLINK"
  | "SOCKET"
  | "OTHER";
export type CandidateRootKind =
  | "HOME"
  | "XDG_CONFIG_HOME"
  | "APPLICATION_SUPPORT"
  | "HOMEBREW_PREFIX"
  | "APP_SUPPORT";
export type CandidateEvidence =
  | "METADATA_PRESENT"
  | "CATALOG_DOCUMENT"
  | "CATALOG_SERVICE"
  | "BOUNDED_ROOT_ENTRY"
  | "SYMLINK_METADATA_ONLY"
  | "EXCLUSION_RULE";
export type CandidateSensitivityHint =
  | "STANDARD"
  | "SENSITIVE"
  | "SECRET"
  | "UNKNOWN";
export type CandidateScanOutcomeKind =
  | "COMPLETE"
  | "CANDIDATE_LIMIT_REACHED"
  | "ENTRY_LIMIT_REACHED"
  | "METADATA_LIMIT_REACHED"
  | "PERMISSION_DENIED"
  | "SYMLINK_METADATA_ONLY"
  | "TIMEOUT"
  | "METADATA_UNAVAILABLE"
  | "INVALID_ROOT";

export interface DiscoveryIssue {
  module: string;
  message: string;
  retryable: boolean;
}

export interface PathMetadata {
  displayPath: string;
  kind: PathEntryKind;
  modifiedAtEpochMs?: number;
}

export interface DetectionEvidence {
  kind: EvidenceKind;
  present: boolean;
  label: string;
  path?: PathMetadata;
}

export interface ManagedAppDetection {
  appId: string;
  displayName: string;
  status: DetectionStatus;
  evidence: readonly DetectionEvidence[];
}

export interface SystemSummary {
  completeness: DiscoveryCompleteness;
  osVersion?: string;
  architecture?: string;
  homeDirectory: string;
  shell?: string;
  applications: readonly ManagedAppDetection[];
  issues: readonly DiscoveryIssue[];
}

export interface BrewInventorySummary {
  available: boolean;
  prefix?: string;
  version?: string;
  formulaCount: number;
  caskCount: number;
}

export interface UnmanagedCandidate {
  candidateId: string;
  displayName: string;
  rootKind: CandidateRootKind;
  relativePath: string;
  entryType: CandidateKind;
  evidence: readonly CandidateEvidence[];
  formatHints: readonly string[];
  sensitivityHint: CandidateSensitivityHint;
  classificationReason: string;
  catalogAppId?: string;
  name: string;
  kind: CandidateKind;
  coverageClass: ManagedAppCoverageClass;
  modifiedAtEpochMs?: number;
}

export interface CandidateScanOutcome {
  kind: CandidateScanOutcomeKind;
  message: string;
  retryable: boolean;
}

export interface CandidateScanSummary {
  candidateCount: number;
  metadataCount: number;
  rootCount: number;
  elapsedMs: number;
  limits: {
    maxCandidates: number;
    maxEntriesPerRoot: number;
    maxMetadataCount: number;
    maxRootDepth: number;
    timeoutMs: number;
  };
  outcomes: readonly CandidateScanOutcome[];
}

export interface ConfigurationCoverage {
  completeness: DiscoveryCompleteness;
  candidates: readonly UnmanagedCandidate[];
  summary: CandidateScanSummary;
  issues: readonly DiscoveryIssue[];
}

export interface SanitizedBaselineCandidate {
  candidateId: string;
  rootKind: CandidateRootKind;
  relativePath: string;
  entryType: CandidateKind;
  evidence: readonly CandidateEvidence[];
  formatHints: readonly string[];
  sensitivityHint: Exclude<CandidateSensitivityHint, "SECRET">;
  coverageClass: Exclude<ManagedAppCoverageClass, "EXCLUDED">;
  classificationReason: string;
  catalogAppId?: string;
}

export interface BaselineCoverageSummary {
  totalCandidateCount: number;
  managedCandidateCount: number;
  managedWritableCount: number;
  managedReadOnlyCount: number;
  unsupportedCount: number;
  excludedCount: number;
  exportedCandidateCount: number;
  omittedCandidateCount: number;
  eligibleTextCount: number;
  managedEligibleTextCount: number;
}

export interface SanitizedCandidateScanSummary
  extends Omit<CandidateScanSummary, "outcomes"> {
  outcomes: readonly CandidateScanOutcomeKind[];
}

export interface SanitizedBaselineManifest {
  schemaVersion: 1;
  completeness: DiscoveryCompleteness;
  coverage: BaselineCoverageSummary;
  scan: SanitizedCandidateScanSummary;
  candidates: readonly SanitizedBaselineCandidate[];
}

export type ModuleSnapshot<T> =
  | { status: "LOADING" }
  | {
      status: "READY";
      data: T;
      completeness?: DiscoveryCompleteness;
      issues?: readonly DiscoveryIssue[];
    }
  | { status: "ERROR"; error: DiscoveryIssue };

export interface DiscoverySnapshot {
  refreshId: string;
  startedAtEpochMs: number;
  completedAtEpochMs?: number;
  system: ModuleSnapshot<SystemSummary>;
  brew: ModuleSnapshot<BrewInventorySummary>;
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>;
}

function decodeText(value: unknown, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    new TextEncoder().encode(value).length > MAX_TEXT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : decodeText(value);
}

function decodeHomeDirectory(value: unknown): string {
  if (value !== "~") {
    throw createInternalError();
  }
  return value;
}

function decodeExecutableAlias(value: unknown): string {
  if (typeof value !== "string" || !/^PATH\/[A-Za-z0-9._+-]+$/.test(value)) {
    throw createInternalError();
  }
  return value;
}

function decodeCount(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeIssue(value: unknown): DiscoveryIssue {
  if (
    !isRecord(value) ||
    typeof value.retryable !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    module: decodeText(value.module),
    message: decodeText(value.message),
    retryable: value.retryable,
  };
}

function decodePath(value: unknown): PathMetadata {
  if (
    !isRecord(value) ||
    !["FILE", "DIRECTORY", "SYMLINK", "OTHER"].includes(String(value.kind))
  ) {
    throw createInternalError();
  }
  return {
    displayPath:
      typeof value.displayPath === "string" &&
      value.displayPath.startsWith("PATH/")
        ? decodeExecutableAlias(value.displayPath)
        : decodeSafeDisplayPath(value.displayPath),
    kind: value.kind as PathEntryKind,
    ...(value.modifiedAtEpochMs === undefined || value.modifiedAtEpochMs === null
      ? {}
      : { modifiedAtEpochMs: decodeCount(value.modifiedAtEpochMs) }),
  };
}

function decodeEvidence(value: unknown): DetectionEvidence {
  if (
    !isRecord(value) ||
    !["CONFIG_PRESENT", "EXECUTABLE_PRESENT"].includes(String(value.kind)) ||
    typeof value.present !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    kind: value.kind as EvidenceKind,
    present: value.present,
    label: decodeText(value.label),
    ...(value.path === undefined || value.path === null
      ? {}
      : { path: decodePath(value.path) }),
  };
}

function decodeApplication(value: unknown): ManagedAppDetection {
  if (
    !isRecord(value) ||
    !["DETECTED", "PARTIAL", "ABSENT"].includes(String(value.status)) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > MAX_EVIDENCE
  ) {
    throw createInternalError();
  }
  return {
    appId: decodeText(value.appId),
    displayName: decodeText(value.displayName),
    status: value.status as DetectionStatus,
    evidence: value.evidence.map(decodeEvidence),
  };
}

function decodeSystem(value: unknown): SystemSummary {
  if (
    !isRecord(value) ||
    !["COMPLETE", "PARTIAL"].includes(String(value.completeness)) ||
    !Array.isArray(value.applications) ||
    value.applications.length > MAX_APPLICATIONS ||
    !Array.isArray(value.issues) ||
    value.issues.length > MAX_ISSUES
  ) {
    throw createInternalError();
  }
  return {
    completeness: value.completeness as DiscoveryCompleteness,
    osVersion: decodeOptionalText(value.osVersion),
    architecture: decodeOptionalText(value.architecture),
    homeDirectory: decodeHomeDirectory(value.homeDirectory),
    shell:
      value.shell === undefined || value.shell === null
        ? undefined
        : decodeExecutableAlias(value.shell),
    applications: value.applications.map(decodeApplication),
    issues: value.issues.map(decodeIssue),
  };
}

function decodeBrewSummary(value: unknown): BrewInventorySummary {
  if (!isRecord(value) || typeof value.available !== "boolean") {
    throw createInternalError();
  }
  return {
    available: value.available,
    prefix: decodeOptionalText(value.prefix),
    version: decodeOptionalText(value.version),
    formulaCount: decodeCount(value.formulaCount, 20_000),
    caskCount: decodeCount(value.caskCount, 20_000),
  };
}

function decodeCandidate(value: unknown): UnmanagedCandidate {
  if (
    !isRecord(value) ||
    ![
      "MANAGED_WRITABLE",
      "MANAGED_READ_ONLY",
      "DETECTED_UNSUPPORTED",
      "EXCLUDED",
    ].includes(String(value.coverageClass ?? "DETECTED_UNSUPPORTED"))
  ) {
    throw createInternalError();
  }
  const legacyName = decodeText(value.name ?? value.displayName);
  if (legacyName.startsWith("/")) {
    throw createInternalError();
  }
  const entryType = value.entryType ?? value.kind;
  if (!CANDIDATE_KINDS.includes(entryType as CandidateKind)) {
    throw createInternalError();
  }
  const inferredLocation = inferLegacyCandidateLocation(legacyName);
  const rootKind = value.rootKind ?? inferredLocation.rootKind;
  if (!CANDIDATE_ROOT_KINDS.includes(rootKind as CandidateRootKind)) {
    throw createInternalError();
  }
  const relativePath =
    value.relativePath === undefined || value.relativePath === null
      ? inferredLocation.relativePath
      : decodeCandidatePath(value.relativePath, rootKind as CandidateRootKind);
  const evidence =
    value.evidence === undefined || value.evidence === null
      ? ["METADATA_PRESENT"]
      : decodeCandidateStringList(
          value.evidence,
          CANDIDATE_EVIDENCE_KINDS,
          MAX_CANDIDATE_EVIDENCE,
        );
  const formatHints =
    value.formatHints === undefined || value.formatHints === null
      ? []
      : decodeCandidateStringList(value.formatHints, undefined, MAX_FORMAT_HINTS);
  const sensitivityHint = value.sensitivityHint ?? "UNKNOWN";
  if (
    !CANDIDATE_SENSITIVITY_HINTS.includes(
      sensitivityHint as CandidateSensitivityHint,
    )
  ) {
    throw createInternalError();
  }
  const coverageClass = (value.coverageClass ??
    "DETECTED_UNSUPPORTED") as ManagedAppCoverageClass;
  const displayName =
    value.displayName === undefined || value.displayName === null
      ? relativePath
      : decodeText(value.displayName);
  if (displayName.startsWith("/")) {
    throw createInternalError();
  }
  return {
    candidateId:
      value.candidateId === undefined || value.candidateId === null
        ? `legacy:${String(rootKind)}:${relativePath}`
        : decodeText(value.candidateId),
    displayName,
    rootKind: rootKind as CandidateRootKind,
    relativePath,
    entryType: entryType as CandidateKind,
    evidence: evidence as CandidateEvidence[],
    formatHints,
    sensitivityHint: sensitivityHint as CandidateSensitivityHint,
    classificationReason:
      value.classificationReason === undefined ||
      value.classificationReason === null
        ? legacyClassificationReason(coverageClass)
        : decodeText(value.classificationReason),
    ...(value.catalogAppId === undefined || value.catalogAppId === null
      ? {}
      : { catalogAppId: decodeText(value.catalogAppId) }),
    name: legacyName,
    kind: entryType as CandidateKind,
    coverageClass,
    ...(value.modifiedAtEpochMs === undefined || value.modifiedAtEpochMs === null
      ? {}
      : { modifiedAtEpochMs: decodeCount(value.modifiedAtEpochMs) }),
  };
}

function inferLegacyCandidateLocation(name: string): {
  rootKind: CandidateRootKind;
  relativePath: string;
} {
  if (name.startsWith("XDG_CONFIG_HOME/")) {
    return { rootKind: "XDG_CONFIG_HOME", relativePath: name };
  }
  if (name.startsWith("Library/Application Support/")) {
    return {
      rootKind: "APPLICATION_SUPPORT",
      relativePath: name.replace(
        "Library/Application Support/",
        "APPLICATION_SUPPORT/",
      ),
    };
  }
  return {
    rootKind: "HOME",
    relativePath: name.startsWith("~/") ? name : `~/${name}`,
  };
}

function decodeCandidatePath(
  value: unknown,
  rootKind: CandidateRootKind,
): string {
  const path = decodeText(value);
  const expectedPrefix =
    rootKind === "HOME" ? "~/" : `${rootKind}/`;
  if (
    !path.startsWith(expectedPrefix) ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  ) {
    throw createInternalError();
  }
  return path;
}

function decodeCandidateStringList(
  value: unknown,
  allowed: readonly string[] | undefined,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw createInternalError();
  }
  return value.map((entry) => {
    const decoded = decodeText(entry);
    if (allowed && !allowed.includes(decoded)) {
      throw createInternalError();
    }
    return decoded;
  });
}

function legacyClassificationReason(
  coverageClass: ManagedAppCoverageClass,
): string {
  switch (coverageClass) {
    case "MANAGED_WRITABLE":
      return "The catalog grants managed read and write support for this document.";
    case "MANAGED_READ_ONLY":
      return "The catalog grants bounded read-only support for this document.";
    case "EXCLUDED":
      return "The entry is excluded from configuration access.";
    default:
      return "The entry was found by bounded metadata discovery without catalog ownership.";
  }
}

function decodeCandidateScanOutcome(value: unknown): CandidateScanOutcome {
  if (
    !isRecord(value) ||
    !CANDIDATE_SCAN_OUTCOME_KINDS.includes(
      value.kind as CandidateScanOutcomeKind,
    ) ||
    typeof value.retryable !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    kind: value.kind as CandidateScanOutcomeKind,
    message: decodeText(value.message),
    retryable: value.retryable,
  };
}

function legacyCandidateScanSummary(
  candidateCount: number,
): CandidateScanSummary {
  return {
    candidateCount,
    metadataCount: candidateCount,
    rootCount: 0,
    elapsedMs: 0,
    limits: {
      maxCandidates: MAX_CANDIDATES,
      maxEntriesPerRoot: MAX_CANDIDATES,
      maxMetadataCount: MAX_CANDIDATES,
      maxRootDepth: 1,
      timeoutMs: 1_500,
    },
    outcomes: [],
  };
}

function decodeCandidateScanSummary(
  value: unknown,
  expectedCandidateCount?: number,
): CandidateScanSummary {
  if (
    !isRecord(value) ||
    !isRecord(value.limits) ||
    !Array.isArray(value.outcomes) ||
    value.outcomes.length > MAX_SCAN_OUTCOMES
  ) {
    throw createInternalError();
  }
  const decodedCandidateCount = decodeCount(
    value.candidateCount,
    MAX_CANDIDATES,
  );
  const metadataCount = decodeCount(value.metadataCount);
  const maxCandidates = decodeCount(value.limits.maxCandidates);
  const maxMetadataCount =
    value.limits.maxMetadataCount === undefined ||
    value.limits.maxMetadataCount === null
      ? Math.max(MAX_CANDIDATES, metadataCount)
      : decodeCount(value.limits.maxMetadataCount);
  if (
    (expectedCandidateCount !== undefined &&
      decodedCandidateCount !== expectedCandidateCount) ||
    maxCandidates < decodedCandidateCount ||
    maxMetadataCount < metadataCount
  ) {
    throw createInternalError();
  }
  return {
    candidateCount: decodedCandidateCount,
    metadataCount,
    rootCount:
      value.rootCount === undefined || value.rootCount === null
        ? 0
        : decodeCount(value.rootCount),
    elapsedMs:
      value.elapsedMs === undefined || value.elapsedMs === null
        ? 0
        : decodeCount(value.elapsedMs),
    limits: {
      maxCandidates,
      maxEntriesPerRoot: decodeCount(value.limits.maxEntriesPerRoot),
      maxMetadataCount,
      maxRootDepth:
        value.limits.maxRootDepth === undefined ||
        value.limits.maxRootDepth === null
          ? 1
          : decodeCount(value.limits.maxRootDepth),
      timeoutMs: decodeCount(value.limits.timeoutMs),
    },
    outcomes: value.outcomes.map(decodeCandidateScanOutcome),
  };
}

function decodeSanitizedBaselineCandidate(
  value: unknown,
): SanitizedBaselineCandidate {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  if (
    !CANDIDATE_ROOT_KINDS.includes(value.rootKind as CandidateRootKind) ||
    !CANDIDATE_KINDS.includes(value.entryType as CandidateKind) ||
    !CANDIDATE_SENSITIVITY_HINTS.includes(
      value.sensitivityHint as CandidateSensitivityHint,
    ) ||
    value.sensitivityHint === "SECRET" ||
    ![
      "MANAGED_WRITABLE",
      "MANAGED_READ_ONLY",
      "DETECTED_UNSUPPORTED",
    ].includes(String(value.coverageClass))
  ) {
    throw createInternalError();
  }
  const rootKind = value.rootKind as CandidateRootKind;
  return {
    candidateId: decodeText(value.candidateId),
    rootKind,
    relativePath: decodeCandidatePath(value.relativePath, rootKind),
    entryType: value.entryType as CandidateKind,
    evidence: decodeCandidateStringList(
      value.evidence,
      CANDIDATE_EVIDENCE_KINDS,
      MAX_CANDIDATE_EVIDENCE,
    ) as CandidateEvidence[],
    formatHints: decodeCandidateStringList(
      value.formatHints,
      undefined,
      MAX_FORMAT_HINTS,
    ),
    sensitivityHint: value.sensitivityHint as Exclude<
      CandidateSensitivityHint,
      "SECRET"
    >,
    coverageClass: value.coverageClass as Exclude<
      ManagedAppCoverageClass,
      "EXCLUDED"
    >,
    classificationReason: decodeText(value.classificationReason),
    ...(value.catalogAppId === undefined || value.catalogAppId === null
      ? {}
      : { catalogAppId: decodeText(value.catalogAppId) }),
  };
}

function decodeBaselineCoverageSummary(
  value: unknown,
  exportedCandidateCount: number,
): BaselineCoverageSummary {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  const summary: BaselineCoverageSummary = {
    totalCandidateCount: decodeCount(value.totalCandidateCount, MAX_CANDIDATES),
    managedCandidateCount: decodeCount(
      value.managedCandidateCount,
      MAX_CANDIDATES,
    ),
    managedWritableCount: decodeCount(
      value.managedWritableCount,
      MAX_CANDIDATES,
    ),
    managedReadOnlyCount: decodeCount(
      value.managedReadOnlyCount,
      MAX_CANDIDATES,
    ),
    unsupportedCount: decodeCount(value.unsupportedCount, MAX_CANDIDATES),
    excludedCount: decodeCount(value.excludedCount, MAX_CANDIDATES),
    exportedCandidateCount: decodeCount(
      value.exportedCandidateCount,
      MAX_CANDIDATES,
    ),
    omittedCandidateCount: decodeCount(
      value.omittedCandidateCount,
      MAX_CANDIDATES,
    ),
    eligibleTextCount: decodeCount(value.eligibleTextCount, MAX_CANDIDATES),
    managedEligibleTextCount: decodeCount(
      value.managedEligibleTextCount,
      MAX_CANDIDATES,
    ),
  };
  if (
    summary.managedCandidateCount !==
      summary.managedWritableCount + summary.managedReadOnlyCount ||
    summary.totalCandidateCount !==
      summary.managedCandidateCount +
        summary.unsupportedCount +
        summary.excludedCount ||
    summary.exportedCandidateCount !== exportedCandidateCount ||
    summary.totalCandidateCount !==
      summary.exportedCandidateCount + summary.omittedCandidateCount ||
    summary.managedEligibleTextCount > summary.eligibleTextCount ||
    summary.eligibleTextCount > summary.totalCandidateCount
  ) {
    throw createInternalError();
  }
  return summary;
}

function decodeSanitizedCandidateScanSummary(
  value: unknown,
  expectedCandidateCount: number,
): SanitizedCandidateScanSummary {
  if (!isRecord(value) || !Array.isArray(value.outcomes)) {
    throw createInternalError();
  }
  const summary = decodeCandidateScanSummary(
    { ...value, outcomes: [] },
    expectedCandidateCount,
  );
  return {
    ...summary,
    outcomes: decodeCandidateStringList(
      value.outcomes,
      CANDIDATE_SCAN_OUTCOME_KINDS,
      MAX_SCAN_OUTCOMES,
    ) as CandidateScanOutcomeKind[],
  };
}

function decodeSanitizedBaselineManifest(
  value: unknown,
): SanitizedBaselineManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !["COMPLETE", "PARTIAL"].includes(String(value.completeness)) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > MAX_CANDIDATES
  ) {
    throw createInternalError();
  }
  const candidates = value.candidates.map(decodeSanitizedBaselineCandidate);
  const coverage = decodeBaselineCoverageSummary(
    value.coverage,
    candidates.length,
  );
  return {
    schemaVersion: 1,
    completeness: value.completeness as DiscoveryCompleteness,
    coverage,
    scan: decodeSanitizedCandidateScanSummary(
      value.scan,
      coverage.totalCandidateCount,
    ),
    candidates,
  };
}

function decodeConfigurationCoverage(value: unknown): ConfigurationCoverage {
  if (Array.isArray(value)) {
    if (value.length > MAX_CANDIDATES) {
      throw createInternalError();
    }
    const candidates = value.map(decodeCandidate);
    return {
      completeness: "COMPLETE",
      candidates,
      summary: legacyCandidateScanSummary(candidates.length),
      issues: [],
    };
  }
  if (
    !isRecord(value) ||
    !["COMPLETE", "PARTIAL"].includes(String(value.completeness)) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > MAX_CANDIDATES ||
    !Array.isArray(value.issues) ||
    value.issues.length > MAX_ISSUES
  ) {
    throw createInternalError();
  }
  const candidates = value.candidates.map(decodeCandidate);
  return {
    completeness: value.completeness as DiscoveryCompleteness,
    candidates,
    summary:
      value.summary === undefined || value.summary === null
        ? legacyCandidateScanSummary(candidates.length)
        : decodeCandidateScanSummary(value.summary, candidates.length),
    issues: value.issues.map(decodeIssue),
  };
}

function decodeCandidateModule(
  value: unknown,
): ModuleSnapshot<readonly UnmanagedCandidate[]> {
  const module = decodeModule(value, decodeConfigurationCoverage);
  if (module.status !== "READY") {
    return module;
  }
  return {
    status: "READY",
    data: module.data.candidates,
    completeness: module.data.completeness,
    issues: module.data.issues,
  };
}

function decodeModule<T>(
  value: unknown,
  decodeData: (data: unknown) => T,
): ModuleSnapshot<T> {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  if (value.status === "LOADING" && value.data === undefined && value.error === undefined) {
    return { status: "LOADING" };
  }
  if (value.status === "READY" && value.error === undefined) {
    return { status: "READY", data: decodeData(value.data) };
  }
  if (value.status === "ERROR" && value.data === undefined) {
    return { status: "ERROR", error: decodeIssue(value.error) };
  }
  throw createInternalError();
}

export function decodeDiscoverySnapshot(value: unknown): DiscoverySnapshot {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  return {
    refreshId: decodeText(value.refreshId, true),
    startedAtEpochMs: decodeCount(value.startedAtEpochMs),
    ...(value.completedAtEpochMs === undefined ||
    value.completedAtEpochMs === null
      ? {}
      : { completedAtEpochMs: decodeCount(value.completedAtEpochMs) }),
    system: decodeModule(value.system, decodeSystem),
    brew: decodeModule(value.brew, decodeBrewSummary),
    candidates: decodeCandidateModule(value.candidates),
  };
}

export function getSystemSnapshot(): Promise<DiscoverySnapshot> {
  return invokeCommand("get_system_snapshot", decodeDiscoverySnapshot);
}

export function refreshSystemSnapshot(): Promise<DiscoverySnapshot> {
  return invokeCommand("refresh_system_snapshot", decodeDiscoverySnapshot);
}

export function getConfigurationCoverage(): Promise<ConfigurationCoverage> {
  return invokeCommand(
    "list_unmanaged_candidates",
    decodeConfigurationCoverage,
  );
}

export function exportSanitizedBaseline(): Promise<SanitizedBaselineManifest> {
  return invokeCommand(
    "export_sanitized_baseline",
    decodeSanitizedBaselineManifest,
  );
}

export async function listUnmanagedCandidates(): Promise<
  readonly UnmanagedCandidate[]
> {
  return (await getConfigurationCoverage()).candidates;
}
