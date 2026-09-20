import { createInternalError, invokeCommand, isRecord } from "./core";
import type { ManagedAppCoverageClass } from "./catalog";

const MAX_TEXT_BYTES = 2 * 1024;
const MAX_APPLICATIONS = 32;
const MAX_EVIDENCE = 32;
const MAX_ISSUES = 32;
const MAX_CANDIDATES = 128;

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
  name: string;
  kind: CandidateKind;
  coverageClass: ManagedAppCoverageClass;
  modifiedAtEpochMs?: number;
}

export interface ConfigurationCoverage {
  completeness: DiscoveryCompleteness;
  candidates: readonly UnmanagedCandidate[];
  issues: readonly DiscoveryIssue[];
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
    displayPath: decodeText(value.displayPath),
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
    homeDirectory: decodeText(value.homeDirectory),
    shell: decodeOptionalText(value.shell),
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
    !["FILE", "DIRECTORY", "SYMLINK", "SOCKET", "OTHER"].includes(
      String(value.kind),
    ) ||
    ![
      "MANAGED_WRITABLE",
      "MANAGED_READ_ONLY",
      "DETECTED_UNSUPPORTED",
      "EXCLUDED",
    ].includes(String(value.coverageClass ?? "DETECTED_UNSUPPORTED"))
  ) {
    throw createInternalError();
  }
  return {
    name: decodeText(value.name),
    kind: value.kind as CandidateKind,
    coverageClass: (value.coverageClass ??
      "DETECTED_UNSUPPORTED") as ManagedAppCoverageClass,
    ...(value.modifiedAtEpochMs === undefined || value.modifiedAtEpochMs === null
      ? {}
      : { modifiedAtEpochMs: decodeCount(value.modifiedAtEpochMs) }),
  };
}

function decodeConfigurationCoverage(value: unknown): ConfigurationCoverage {
  if (Array.isArray(value)) {
    if (value.length > MAX_CANDIDATES) {
      throw createInternalError();
    }
    return {
      completeness: "COMPLETE",
      candidates: value.map(decodeCandidate),
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
  return {
    completeness: value.completeness as DiscoveryCompleteness,
    candidates: value.candidates.map(decodeCandidate),
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

export async function listUnmanagedCandidates(): Promise<
  readonly UnmanagedCandidate[]
> {
  return (await getConfigurationCoverage()).candidates;
}
