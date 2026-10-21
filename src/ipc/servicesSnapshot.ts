import { createInternalError, invokeCommand, isRecord } from "./core";
import {
  LAUNCHD_DOMAINS,
  LAUNCHD_LOAD_STATES,
  LAUNCHD_OWNERSHIPS,
  LAUNCHD_RUN_STATES,
  LAUNCHD_SCOPES,
  LAUNCHD_SOURCE_REASONS,
  LAUNCHD_SOURCE_STATUSES,
  LAUNCHD_SOURCES,
  type LaunchdDomain,
  type LaunchdLoadState,
  type LaunchdOwnershipKind,
  type LaunchdRunState,
  type LaunchdScope,
  type LaunchdSource,
  type LaunchdSourceReason,
  type LaunchdSourceStatus,
} from "./services";

// Read-only snapshot of resident Caddy instances. It is evidence only: nothing
// here can stop, reload or adopt a job, and no field carries authorization.

export const RESIDENT_CONFIG_FLAGS = ["LONG", "LONG_EQUALS", "SHORT"] as const;
export type ResidentConfigFlag = (typeof RESIDENT_CONFIG_FLAGS)[number];

export const RESIDENT_CONFIG_UNKNOWN_REASONS = [
  "MISSING",
  "NO_VALUE",
  "AMBIGUOUS",
] as const;
export type ResidentConfigUnknownReason =
  (typeof RESIDENT_CONFIG_UNKNOWN_REASONS)[number];

export const RESIDENT_INCOMPLETE_REASONS = [
  "SOURCE_INCOMPLETE",
  "DISCOVERY_TRUNCATED",
  "PLIST_UNPARSED",
  "LOAD_STATE_UNKNOWN",
  "ARGUMENTS_TRUNCATED",
  "DEFINITION_AMBIGUOUS",
] as const;
export type ResidentIncompleteReason =
  (typeof RESIDENT_INCOMPLETE_REASONS)[number];

const MAX_SNAPSHOT_SOURCES = 16;
const MAX_SNAPSHOT_INSTANCES = 256;
const MAX_SNAPSHOT_ARGUMENTS = 128;
const MAX_SNAPSHOT_REASONS = 16;
const MAX_SNAPSHOT_TEXT_BYTES = 2 * 1024;

export interface ResidentCaddySnapshotSource {
  source: LaunchdSource;
  status: LaunchdSourceStatus;
  reason?: LaunchdSourceReason;
}

export interface ResidentCaddyConfig {
  path?: string;
  flag?: ResidentConfigFlag;
  unknownReason?: ResidentConfigUnknownReason;
}

export interface ResidentCaddyInstance {
  label: string;
  domain: LaunchdDomain;
  scope: LaunchdScope;
  ownership: LaunchdOwnershipKind;
  plistPath?: string;
  executable?: string;
  arguments: string[];
  adapter?: string;
  config: ResidentCaddyConfig;
  loadState: LaunchdLoadState;
  runState: LaunchdRunState;
  pid?: number;
  observedAtMs: number;
  complete: boolean;
  incompleteReasons: ResidentIncompleteReason[];
}

export interface ResidentCaddySnapshot {
  observedAtMs: number;
  complete: boolean;
  canConcludeAbsence: boolean;
  sources: ResidentCaddySnapshotSource[];
  instances: ResidentCaddyInstance[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return value === undefined || value === null ? undefined : oneOf(value, allowed);
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > MAX_SNAPSHOT_TEXT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function nonEmptyText(value: unknown): string {
  const decoded = text(value);
  if (decoded.length === 0) throw createInternalError();
  return decoded;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInternalError();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createInternalError();
  }
  return value;
}

function optionalCount(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : count(value);
}

function list<T>(
  value: unknown,
  limit: number,
  decodeItem: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw createInternalError();
  }
  return value.map((item) => decodeItem(item));
}

function decodeSource(value: unknown): ResidentCaddySnapshotSource {
  if (!isRecord(value)) throw createInternalError();
  return {
    source: oneOf(value.source, LAUNCHD_SOURCES),
    status: oneOf(value.status, LAUNCHD_SOURCE_STATUSES),
    reason: optionalOneOf(value.reason, LAUNCHD_SOURCE_REASONS),
  };
}

// A path is given only with the flag that states it; otherwise exactly the
// reason is given and no location is guessed.
function decodeConfig(value: unknown): ResidentCaddyConfig {
  if (!isRecord(value)) throw createInternalError();
  const path = optionalText(value.path);
  const flag = optionalOneOf(value.flag, RESIDENT_CONFIG_FLAGS);
  const unknownReason = optionalOneOf(
    value.unknownReason,
    RESIDENT_CONFIG_UNKNOWN_REASONS,
  );
  if (path !== undefined) {
    if (path.length === 0 || flag === undefined || unknownReason !== undefined) {
      throw createInternalError();
    }
  } else if (flag !== undefined || unknownReason === undefined) {
    throw createInternalError();
  }
  return { path, flag, unknownReason };
}

function decodeInstance(value: unknown): ResidentCaddyInstance {
  if (!isRecord(value)) throw createInternalError();
  const loadState = oneOf(value.loadState, LAUNCHD_LOAD_STATES);
  const runState = oneOf(value.runState, LAUNCHD_RUN_STATES);
  const pid = optionalCount(value.pid);
  // A PID exists only for a running job, and a running job is a loaded one.
  if (pid !== undefined && runState !== "RUNNING") throw createInternalError();
  if (runState === "RUNNING" && loadState !== "LOADED") throw createInternalError();
  const complete = boolean(value.complete);
  const incompleteReasons = list(
    value.incompleteReasons,
    MAX_SNAPSHOT_REASONS,
    (item) => oneOf(item, RESIDENT_INCOMPLETE_REASONS),
  );
  if (complete !== (incompleteReasons.length === 0)) throw createInternalError();
  return {
    label: nonEmptyText(value.label),
    domain: oneOf(value.domain, LAUNCHD_DOMAINS),
    scope: oneOf(value.scope, LAUNCHD_SCOPES),
    ownership: oneOf(value.ownership, LAUNCHD_OWNERSHIPS),
    plistPath: optionalText(value.plistPath),
    executable: optionalText(value.executable),
    arguments: list(value.arguments, MAX_SNAPSHOT_ARGUMENTS, text),
    adapter: optionalText(value.adapter),
    config: decodeConfig(value.config),
    loadState,
    runState,
    pid,
    observedAtMs: count(value.observedAtMs),
    complete,
    incompleteReasons,
  };
}

export function decodeResidentCaddySnapshot(value: unknown): ResidentCaddySnapshot {
  if (!isRecord(value)) throw createInternalError();
  const complete = boolean(value.complete);
  const canConcludeAbsence = boolean(value.canConcludeAbsence);
  const sources = list(value.sources, MAX_SNAPSHOT_SOURCES, decodeSource);
  const instances = list(value.instances, MAX_SNAPSHOT_INSTANCES, decodeInstance);
  // Absence may be concluded exactly when the whole picture is complete. A
  // complete picture cannot hold a failed source or an incomplete instance.
  if (canConcludeAbsence !== complete) throw createInternalError();
  if (complete) {
    if (sources.some((source) => source.status !== "COMPLETE")) {
      throw createInternalError();
    }
    if (instances.some((instance) => !instance.complete)) {
      throw createInternalError();
    }
  }
  return {
    observedAtMs: count(value.observedAtMs),
    complete,
    canConcludeAbsence,
    sources,
    instances,
  };
}

export function getResidentCaddySnapshot(): Promise<ResidentCaddySnapshot> {
  return invokeCommand(
    "get_resident_caddy_snapshot",
    decodeResidentCaddySnapshot,
  );
}
