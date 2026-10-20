import { createInternalError, invokeCommand, isRecord } from "./core";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

export type ServiceScope = "USER" | "SYSTEM" | "UNKNOWN";
export type ServiceState = "STARTED" | "STOPPED" | "ERROR" | "UNKNOWN";
export type ConfigValidity = "VALID" | "INVALID" | "UNAVAILABLE";
export type ServiceAction = "START" | "STOP" | "RESTART";

export interface ServiceSummary {
  serviceId: string;
  displayName: string;
  state: ServiceState;
  status: string;
  scope: ServiceScope;
  user?: string;
  file?: string;
  pid?: number;
  exitCode?: number;
  manageable: boolean;
}

export interface ServiceDetails extends ServiceSummary {
  packageVersion?: string;
  configValidity: ConfigValidity;
  configIssue?: string;
}

export interface ServiceActionInput {
  action: ServiceAction;
  serviceId: string;
}

function decodeText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).length > 2 * 1024
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : decodeText(value);
}

function decodeOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw createInternalError();
  }
  return value;
}

export function decodeServiceSummary(value: unknown): ServiceSummary {
  if (
    !isRecord(value) ||
    !["STARTED", "STOPPED", "ERROR", "UNKNOWN"].includes(String(value.state)) ||
    !["USER", "SYSTEM", "UNKNOWN"].includes(String(value.scope)) ||
    typeof value.manageable !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    serviceId: decodeText(value.serviceId),
    displayName: decodeText(value.displayName),
    state: value.state as ServiceState,
    status: decodeText(value.status),
    scope: value.scope as ServiceScope,
    ...(decodeOptionalText(value.user) === undefined
      ? {}
      : { user: decodeOptionalText(value.user) }),
    ...(decodeOptionalText(value.file) === undefined
      ? {}
      : { file: decodeOptionalText(value.file) }),
    ...(decodeOptionalInteger(value.pid) === undefined
      ? {}
      : { pid: decodeOptionalInteger(value.pid) }),
    ...(decodeOptionalInteger(value.exitCode) === undefined
      ? {}
      : { exitCode: decodeOptionalInteger(value.exitCode) }),
    manageable: value.manageable,
  };
}

export function decodeServiceDetails(value: unknown): ServiceDetails {
  const summary = decodeServiceSummary(value);
  if (
    !isRecord(value) ||
    !["VALID", "INVALID", "UNAVAILABLE"].includes(
      String(value.configValidity),
    )
  ) {
    throw createInternalError();
  }
  return {
    ...summary,
    ...(decodeOptionalText(value.packageVersion) === undefined
      ? {}
      : { packageVersion: decodeOptionalText(value.packageVersion) }),
    configValidity: value.configValidity as ConfigValidity,
    ...(decodeOptionalText(value.configIssue) === undefined
      ? {}
      : { configIssue: decodeOptionalText(value.configIssue) }),
  };
}

export function listServices(): Promise<ServiceSummary[]> {
  return invokeCommand("list_services", (value) => {
    if (!Array.isArray(value) || value.length > 512) {
      throw createInternalError();
    }
    return value.map(decodeServiceSummary);
  });
}

export function getService(serviceId: string): Promise<ServiceDetails> {
  return invokeCommand("get_service", decodeServiceDetails, { serviceId });
}

export function previewServiceAction(
  input: ServiceActionInput,
): Promise<OperationPreview> {
  return invokeCommand("preview_service_action", decodeOperationPreview, {
    input,
  });
}

export function executeServiceAction(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_service_action", decodeOperationDetails, {
    operationId,
  });
}

// launchd discovery (read-only). The backend takes no label or path from the
// frontend; every enum is checked and unknown values fail closed.

export const LAUNCHD_DOMAINS = ["GUI", "SYSTEM"] as const;
export type LaunchdDomain = (typeof LAUNCHD_DOMAINS)[number];

export const LAUNCHD_DIRECTORIES = [
  "USER_LAUNCH_AGENTS",
  "GLOBAL_LAUNCH_AGENTS",
  "GLOBAL_LAUNCH_DAEMONS",
  "APPLE_LAUNCH_AGENTS",
  "APPLE_LAUNCH_DAEMONS",
] as const;
export type LaunchdDirectory = (typeof LAUNCHD_DIRECTORIES)[number];

/** Where a service is defined, by directory only; not an ownership verdict. */
export const LAUNCHD_SCOPES = [
  "USER_AGENT",
  "GLOBAL_AGENT",
  "SYSTEM_DAEMON",
  "APPLE_AGENT",
  "APPLE_DAEMON",
  "MIXED",
  "UNATTRIBUTED",
] as const;
export type LaunchdScope = (typeof LAUNCHD_SCOPES)[number];

export const LAUNCHD_LOAD_STATES = [
  "LOADED",
  "NOT_LOADED",
  "UNKNOWN",
  "INACCESSIBLE",
] as const;
export type LaunchdLoadState = (typeof LAUNCHD_LOAD_STATES)[number];

/** A process exists; this is not a health verdict. */
export const LAUNCHD_RUN_STATES = [
  "RUNNING",
  "NOT_RUNNING",
  "UNKNOWN",
  "INACCESSIBLE",
] as const;
export type LaunchdRunState = (typeof LAUNCHD_RUN_STATES)[number];

export const LAUNCHD_CORRELATIONS = [
  "MATCHED",
  "FILE_ONLY",
  "LOADED_ONLY",
  "UNMATCHED_FILE",
] as const;
export type LaunchdCorrelation = (typeof LAUNCHD_CORRELATIONS)[number];

export const LAUNCHD_CONFIG_PRESENCES = [
  "FOUND",
  "NOT_FOUND_IN_SCANNED",
  "UNKNOWN",
] as const;
export type LaunchdConfigPresence = (typeof LAUNCHD_CONFIG_PRESENCES)[number];

export const LAUNCHD_LABEL_SOURCES = ["LAUNCHCTL", "PLIST", "FILE_NAME"] as const;
export type LaunchdLabelSource = (typeof LAUNCHD_LABEL_SOURCES)[number];

export const LAUNCHD_ISSUES = [
  "DUPLICATE_LABEL",
  "DUPLICATE_LOADED_LABEL",
  "LABEL_FILENAME_MISMATCH",
  "MISSING_LABEL",
  "INVALID_LABEL",
] as const;
export type LaunchdIssue = (typeof LAUNCHD_ISSUES)[number];

/**
 * The backend's verdict on who owns a job. Unlike `LaunchdScope`, which only
 * says which directory a file sits in, this is judged from the file owner, the
 * file type, the location and the label together.
 */
export const LAUNCHD_OWNERSHIPS = [
  "CURRENT_USER_AGENT",
  "GLOBAL_AGENT",
  "SYSTEM_DAEMON",
  "APPLE_MANAGED",
  "THIRD_PARTY",
  "USERHOME_CREATED",
  "USERHOME_ADOPTED",
] as const;
export type LaunchdOwnershipKind = (typeof LAUNCHD_OWNERSHIPS)[number];

export const LAUNCHD_READ_ONLY_REASONS = [
  "APPLE_MANAGED",
  "SYSTEM_DAEMON_LOCATION",
  "GLOBAL_AGENT_LOCATION",
  "NOT_ADOPTED",
  "NO_CONFIG_FILE",
  "SYMBOLIC_LINK",
  "LINK_TARGET_OUTSIDE",
  "OWNER_NOT_CURRENT_USER",
  "OWNER_UNKNOWN",
  "PLIST_NOT_PARSED",
  "LABEL_NOT_FROM_PLIST",
  "LABEL_FILENAME_MISMATCH",
  "DUPLICATE_DEFINITION",
  "UNAPPROVED_LOCATION",
  "DISCOVERY_INCOMPLETE",
] as const;
export type LaunchdReadOnlyReason = (typeof LAUNCHD_READ_ONLY_REASONS)[number];

export const LAUNCHD_EVIDENCE = [
  "LABEL_APPLE_NAMESPACE",
  "APPLE_PATH",
  "LABEL_USERHOME_NAMESPACE",
  "ADOPTION_RECORD",
  "DOMAIN_GUI",
  "DOMAIN_SYSTEM",
  "IN_USER_LAUNCH_AGENTS",
  "IN_GLOBAL_LAUNCH_AGENTS",
  "IN_GLOBAL_LAUNCH_DAEMONS",
  "OWNER_CURRENT_USER",
  "OWNER_OTHER_USER",
  "OWNER_UNKNOWN",
  "REGULAR_FILE",
  "SYMBOLIC_LINK",
  "NO_CONFIG_FILE",
] as const;
export type LaunchdEvidence = (typeof LAUNCHD_EVIDENCE)[number];

export const LAUNCHD_FILE_KINDS = ["REGULAR", "LINK"] as const;
export type LaunchdFileKind = (typeof LAUNCHD_FILE_KINDS)[number];

export const LAUNCHD_LINK_STATES = ["INSIDE", "OUTSIDE", "UNRESOLVED"] as const;
export type LaunchdLinkState = (typeof LAUNCHD_LINK_STATES)[number];

export const LAUNCHD_PARSE_STATUSES = [
  "PARSED",
  "CONVERT_FAILED",
  "TOO_LARGE",
  "LINK_NOT_READ",
  "UNREADABLE",
  "TIMED_OUT",
  "OUTPUT_TOO_LARGE",
  "TOOL_UNAVAILABLE",
  "NOT_ATTEMPTED",
] as const;
export type LaunchdParseStatus = (typeof LAUNCHD_PARSE_STATUSES)[number];

export const LAUNCHD_KEEP_ALIVE_MODES = [
  "ALWAYS",
  "NEVER",
  "CONDITIONAL",
] as const;
export type LaunchdKeepAliveMode = (typeof LAUNCHD_KEEP_ALIVE_MODES)[number];

export const LAUNCHD_SOURCES = [
  "LAUNCHCTL_LIST",
  "LAUNCHCTL_PRINT_SYSTEM",
  ...LAUNCHD_DIRECTORIES,
] as const;
export type LaunchdSource = (typeof LAUNCHD_SOURCES)[number];

export const LAUNCHD_SOURCE_STATUSES = [
  "COMPLETE",
  "PARTIAL",
  "INACCESSIBLE",
  "FAILED",
] as const;
export type LaunchdSourceStatus = (typeof LAUNCHD_SOURCE_STATUSES)[number];

export const LAUNCHD_SOURCE_REASONS = [
  "TIMEOUT",
  "OUTPUT_TOO_LARGE",
  "PROCESS_FAILED",
  "PERMISSION_DENIED",
  "TOOL_UNAVAILABLE",
  "UNPARSED_OUTPUT",
  "ENTRY_LIMIT",
  "DIRECTORY_MISSING",
  "OUTSIDE_HOME",
  "HOME_UNAVAILABLE",
  "IO",
  "FILE_ERRORS",
  "TIME_BUDGET",
] as const;
export type LaunchdSourceReason = (typeof LAUNCHD_SOURCE_REASONS)[number];

export interface LaunchdLastExit {
  kind: "CODE" | "SIGNAL";
  value: number;
}

export interface LaunchdKeepAlive {
  mode: LaunchdKeepAliveMode;
  conditions: string[];
}

export interface LaunchdLinkTarget {
  state: LaunchdLinkState;
  display?: string;
}

export interface LaunchdPlistDetails {
  program?: string;
  /** Secret-looking values are already masked by the backend. */
  programArguments: string[];
  argumentsTruncated: boolean;
  /** Names only; values are never sent. */
  environmentKeys: string[];
  runAtLoad?: boolean;
  keepAlive?: LaunchdKeepAlive;
  standardOutPath?: string;
  standardErrorPath?: string;
  disabled?: boolean;
  userName?: string;
}

export interface LaunchdConfigFile {
  path: string;
  directory: LaunchdDirectory;
  scope: LaunchdScope;
  isApplePath: boolean;
  ownerUid?: number;
  kind: LaunchdFileKind;
  linkTarget?: LaunchdLinkTarget;
  parseStatus: LaunchdParseStatus;
  details?: LaunchdPlistDetails;
}

export interface LaunchdOwnership {
  kind: LaunchdOwnershipKind;
  /** Judged by the backend; the backend rechecks before any change. */
  modifiable: boolean;
  /** Empty exactly when `modifiable`. */
  readOnlyReasons: LaunchdReadOnlyReason[];
  /** The facts the verdict rests on; never empty. */
  evidence: LaunchdEvidence[];
}

export interface LaunchdService {
  id: string;
  label: string;
  labelSource: LaunchdLabelSource;
  domain: LaunchdDomain;
  domainTarget: string;
  scope: LaunchdScope;
  correlation: LaunchdCorrelation;
  loadState: LaunchdLoadState;
  runState: LaunchdRunState;
  pid?: number;
  /** A nonzero exit is not an error verdict. */
  lastExit?: LaunchdLastExit;
  configPresence: LaunchdConfigPresence;
  configFiles: LaunchdConfigFile[];
  issues: LaunchdIssue[];
  ownership: LaunchdOwnership;
}

export interface LaunchdSourceReport {
  source: LaunchdSource;
  status: LaunchdSourceStatus;
  reason?: LaunchdSourceReason;
  items: number;
  failedFiles: number;
}

export interface LaunchdDiscovery {
  services: LaunchdService[];
  sources: LaunchdSourceReport[];
  /** True only when every source was complete and nothing was cut off. */
  complete: boolean;
  truncated: boolean;
}

const MAX_LAUNCHD_SERVICES = 4096;
const MAX_LAUNCHD_FILES_PER_SERVICE = 64;
const MAX_LAUNCHD_LIST_ITEMS = 256;
const MAX_LAUNCHD_TEXT_BYTES = 2 * 1024;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

function decodeLaunchdText(value: unknown): string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > MAX_LAUNCHD_TEXT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeLaunchdNonEmptyText(value: unknown): string {
  const text = decodeLaunchdText(value);
  if (text.length === 0) throw createInternalError();
  return text;
}

function decodeOptionalLaunchdText(value: unknown): string | undefined {
  return value === undefined || value === null
    ? undefined
    : decodeLaunchdText(value);
}

function decodeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInternalError();
  return value;
}

function decodeOptionalBoolean(value: unknown): boolean | undefined {
  return value === undefined || value === null ? undefined : decodeBoolean(value);
}

function decodeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalCount(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : decodeCount(value);
}

function decodeList<T>(
  value: unknown,
  limit: number,
  decodeItem: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw createInternalError();
  }
  return value.map(decodeItem);
}

function decodeLaunchdLastExit(value: unknown): LaunchdLastExit | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    typeof value.value !== "number" ||
    !Number.isSafeInteger(value.value)
  ) {
    throw createInternalError();
  }
  return {
    kind: oneOf(value.kind, ["CODE", "SIGNAL"] as const),
    value: value.value,
  };
}

function decodeLaunchdKeepAlive(value: unknown): LaunchdKeepAlive | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw createInternalError();
  return {
    mode: oneOf(value.mode, LAUNCHD_KEEP_ALIVE_MODES),
    conditions: decodeList(value.conditions, 16, decodeLaunchdText),
  };
}

function decodeLaunchdPlistDetails(
  value: unknown,
): LaunchdPlistDetails | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw createInternalError();
  const program = decodeOptionalLaunchdText(value.program);
  const runAtLoad = decodeOptionalBoolean(value.runAtLoad);
  const keepAlive = decodeLaunchdKeepAlive(value.keepAlive);
  const standardOutPath = decodeOptionalLaunchdText(value.standardOutPath);
  const standardErrorPath = decodeOptionalLaunchdText(value.standardErrorPath);
  const disabled = decodeOptionalBoolean(value.disabled);
  const userName = decodeOptionalLaunchdText(value.userName);
  return {
    ...(program === undefined ? {} : { program }),
    programArguments: decodeList(
      value.programArguments,
      MAX_LAUNCHD_LIST_ITEMS,
      decodeLaunchdText,
    ),
    argumentsTruncated: decodeBoolean(value.argumentsTruncated),
    environmentKeys: decodeList(
      value.environmentKeys,
      MAX_LAUNCHD_LIST_ITEMS,
      decodeLaunchdText,
    ),
    ...(runAtLoad === undefined ? {} : { runAtLoad }),
    ...(keepAlive === undefined ? {} : { keepAlive }),
    ...(standardOutPath === undefined ? {} : { standardOutPath }),
    ...(standardErrorPath === undefined ? {} : { standardErrorPath }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(userName === undefined ? {} : { userName }),
  };
}

function decodeLaunchdLinkTarget(value: unknown): LaunchdLinkTarget | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw createInternalError();
  const display = decodeOptionalLaunchdText(value.display);
  return {
    state: oneOf(value.state, LAUNCHD_LINK_STATES),
    ...(display === undefined ? {} : { display }),
  };
}

export function decodeLaunchdConfigFile(value: unknown): LaunchdConfigFile {
  if (!isRecord(value)) throw createInternalError();
  const ownerUid = decodeOptionalCount(value.ownerUid);
  const linkTarget = decodeLaunchdLinkTarget(value.linkTarget);
  const details = decodeLaunchdPlistDetails(value.details);
  return {
    path: decodeLaunchdNonEmptyText(value.path),
    directory: oneOf(value.directory, LAUNCHD_DIRECTORIES),
    scope: oneOf(value.scope, LAUNCHD_SCOPES),
    isApplePath: decodeBoolean(value.isApplePath),
    ...(ownerUid === undefined ? {} : { ownerUid }),
    kind: oneOf(value.kind, LAUNCHD_FILE_KINDS),
    ...(linkTarget === undefined ? {} : { linkTarget }),
    parseStatus: oneOf(value.parseStatus, LAUNCHD_PARSE_STATUSES),
    ...(details === undefined ? {} : { details }),
  };
}

const MAX_READ_ONLY_REASONS = 16;
const MAX_EVIDENCE = 32;

/** The namespace of jobs UserHome creates; the backend checks more than this. */
const USERHOME_LABEL_NAMESPACE = "com.zephyr194.userhome.agent.";

const MODIFIABLE_OWNERSHIPS: readonly LaunchdOwnershipKind[] = [
  "USERHOME_CREATED",
  "USERHOME_ADOPTED",
];

function decodeLaunchdOwnership(value: unknown): LaunchdOwnership {
  if (!isRecord(value)) throw createInternalError();
  const kind = oneOf(value.ownership, LAUNCHD_OWNERSHIPS);
  const modifiable = decodeBoolean(value.modifiable);
  const readOnlyReasons = decodeList(
    value.readOnlyReasons,
    MAX_READ_ONLY_REASONS,
    (reason) => oneOf(reason, LAUNCHD_READ_ONLY_REASONS),
  );
  const evidence = decodeList(value.evidence, MAX_EVIDENCE, (item) =>
    oneOf(item, LAUNCHD_EVIDENCE),
  );
  // A verdict is modifiable exactly when nothing keeps it read-only, it always
  // shows what it rests on, and only UserHome's own jobs can ever be modifiable.
  if (
    modifiable !== (readOnlyReasons.length === 0) ||
    evidence.length === 0 ||
    (modifiable && !MODIFIABLE_OWNERSHIPS.includes(kind))
  ) {
    throw createInternalError();
  }
  return { kind, modifiable, readOnlyReasons, evidence };
}

/**
 * A modifiable verdict must agree with what the same payload shows: a user
 * session job with one regular file in the user's LaunchAgents, no Apple label
 * or path, and a UserHome label for a created job. Otherwise fail closed.
 */
function assertConsistentOwnership(service: LaunchdService): void {
  const { ownership } = service;
  if (!ownership.modifiable) return;
  const [file, ...others] = service.configFiles;
  const consistent =
    service.domain === "GUI" &&
    file !== undefined &&
    others.length === 0 &&
    file.directory === "USER_LAUNCH_AGENTS" &&
    file.kind === "REGULAR" &&
    !file.isApplePath &&
    !service.label.startsWith("com.apple.") &&
    (ownership.kind !== "USERHOME_CREATED" ||
      (service.label.startsWith(USERHOME_LABEL_NAMESPACE) &&
        service.label.length > USERHOME_LABEL_NAMESPACE.length));
  if (!consistent) throw createInternalError();
}

export function decodeLaunchdService(value: unknown): LaunchdService {
  if (!isRecord(value)) throw createInternalError();
  const loadState = oneOf(value.loadState, LAUNCHD_LOAD_STATES);
  const runState = oneOf(value.runState, LAUNCHD_RUN_STATES);
  const pid = decodeOptionalCount(value.pid);
  const lastExit = decodeLaunchdLastExit(value.lastExit);
  // A process can only exist for a loaded job.
  if (pid !== undefined && (loadState !== "LOADED" || runState !== "RUNNING")) {
    throw createInternalError();
  }
  const decoded: LaunchdService = {
    id: decodeLaunchdNonEmptyText(value.id),
    label: decodeLaunchdNonEmptyText(value.label),
    labelSource: oneOf(value.labelSource, LAUNCHD_LABEL_SOURCES),
    domain: oneOf(value.domain, LAUNCHD_DOMAINS),
    domainTarget: decodeLaunchdNonEmptyText(value.domainTarget),
    scope: oneOf(value.scope, LAUNCHD_SCOPES),
    correlation: oneOf(value.correlation, LAUNCHD_CORRELATIONS),
    loadState,
    runState,
    ...(pid === undefined ? {} : { pid }),
    ...(lastExit === undefined ? {} : { lastExit }),
    configPresence: oneOf(value.configPresence, LAUNCHD_CONFIG_PRESENCES),
    configFiles: decodeList(
      value.configFiles,
      MAX_LAUNCHD_FILES_PER_SERVICE,
      decodeLaunchdConfigFile,
    ),
    issues: decodeList(value.issues, 8, (issue) =>
      oneOf(issue, LAUNCHD_ISSUES),
    ),
    ownership: decodeLaunchdOwnership(value.ownership),
  };
  assertConsistentOwnership(decoded);
  return decoded;
}

export function decodeLaunchdSourceReport(value: unknown): LaunchdSourceReport {
  if (!isRecord(value)) throw createInternalError();
  const reason =
    value.reason === undefined || value.reason === null
      ? undefined
      : oneOf(value.reason, LAUNCHD_SOURCE_REASONS);
  return {
    source: oneOf(value.source, LAUNCHD_SOURCES),
    status: oneOf(value.status, LAUNCHD_SOURCE_STATUSES),
    ...(reason === undefined ? {} : { reason }),
    items: decodeCount(value.items),
    failedFiles: decodeCount(value.failedFiles),
  };
}

export function decodeLaunchdDiscovery(value: unknown): LaunchdDiscovery {
  if (!isRecord(value)) throw createInternalError();
  const services = decodeList(
    value.services,
    MAX_LAUNCHD_SERVICES,
    decodeLaunchdService,
  );
  const sources = decodeList(value.sources, 16, decodeLaunchdSourceReport);
  const complete = decodeBoolean(value.complete);
  const truncated = decodeBoolean(value.truncated);
  // A result must never claim to be complete while a source failed or the
  // list was cut off.
  if (
    complete &&
    (truncated || sources.some((source) => source.status !== "COMPLETE"))
  ) {
    throw createInternalError();
  }
  return { services, sources, complete, truncated };
}

export function listLaunchdServices(): Promise<LaunchdDiscovery> {
  return invokeCommand("list_launchd_services", decodeLaunchdDiscovery);
}
