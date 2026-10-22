import {
  createInternalError,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";
import {
  decodeResourceWriteExecution,
  decodeResourceWritePreview,
  decodeWriteOutcome,
  type ResourceWriteExecution,
  type ResourceWritePreview,
  type WriteOutcome,
} from "./resources";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

export type ServiceScope = "USER" | "SYSTEM" | "UNKNOWN";
export type ServiceState = "STARTED" | "STOPPED" | "ERROR" | "UNKNOWN";

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

export function listServices(): Promise<ServiceSummary[]> {
  return invokeCommand("list_services", (value) => {
    if (!Array.isArray(value) || value.length > 512) {
      throw createInternalError();
    }
    return value.map(decodeServiceSummary);
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

// Creating a UserHome-owned launchd job. The request is a typed form; the file
// path is fixed in the backend and never sent from here. Nothing is loaded or
// started, and no environment value ever comes back.

export const CREATE_SERVICE_NAMESPACE = "com.zephyr194.userhome.agent.";
export const CREATE_SERVICE_LIMITS = {
  labelSuffixBytes: 64,
  arguments: 64,
  argumentBytes: 4096,
  environmentEntries: 32,
  environmentKeyBytes: 128,
  environmentValueBytes: 4096,
  pathBytes: 1024,
} as const;

export interface CreateServiceRequest {
  /** The part after the namespace, or the full label inside it. */
  label: string;
  executable: string;
  arguments: string[];
  workingDirectory?: string;
  environment: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
  runAtLoad: boolean;
  keepAlive: boolean;
}

export interface CreateServicePreview extends ResourceWritePreview {
  label: string;
  /** `~/Library/LaunchAgents/<label>.plist` */
  filePath: string;
  executable: string;
  /** The real argument list with secret-looking values hidden. */
  arguments: string[];
  argumentsRedacted: boolean;
  workingDirectory?: string;
  /** Names only. */
  environmentKeys: string[];
  stdoutPath?: string;
  stderrPath?: string;
  runAtLoad: boolean;
  keepAlive: boolean;
  persistenceNotes: string[];
  effectNote: string;
}

export interface CreateServiceExecution extends ResourceWriteExecution {
  label: string;
  filePath: string;
  loaded: false;
  effectNote: string;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL_SUFFIX_PATTERN = /^[A-Za-z0-9._-]+$/;
const BIDI_CONTROLS = new Set([
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067,
  0x2068, 0x2069,
]);

/**
 * Control characters (C0, DEL, C1), line and paragraph separators and the
 * bidirectional override characters: the set the backend refuses in every
 * text field of a job definition.
 */
export function hasForbiddenTextCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159) || BIDI_CONTROLS.has(code)) {
      return true;
    }
  }
  return false;
}

function decodeBoundedText(value: unknown, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > maxBytes ||
    hasForbiddenTextCharacters(value)
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeDisplayPath(value: unknown): string {
  const path = decodeBoundedText(value, CREATE_SERVICE_LIMITS.pathBytes);
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    throw createInternalError();
  }
  return path;
}

function decodeOptionalDisplayPath(value: unknown): string | undefined {
  return value === undefined || value === null
    ? undefined
    : decodeDisplayPath(value);
}

function decodeCreatedLabel(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith(CREATE_SERVICE_NAMESPACE)) {
    throw createInternalError();
  }
  const suffix = value.slice(CREATE_SERVICE_NAMESPACE.length);
  if (
    suffix.length === 0 ||
    suffix.length > CREATE_SERVICE_LIMITS.labelSuffixBytes ||
    !LABEL_SUFFIX_PATTERN.test(suffix)
  ) {
    throw createInternalError();
  }
  return value;
}

export function createdServiceFilePath(label: string): string {
  return `~/Library/LaunchAgents/${label}.plist`;
}

function decodeEnvironmentKeys(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > CREATE_SERVICE_LIMITS.environmentEntries
  ) {
    throw createInternalError();
  }
  const keys = value.map((key): string => {
    if (
      typeof key !== "string" ||
      key.length > CREATE_SERVICE_LIMITS.environmentKeyBytes ||
      !ENV_KEY_PATTERN.test(key)
    ) {
      throw createInternalError();
    }
    return key;
  });
  if (new Set(keys).size !== keys.length) throw createInternalError();
  return keys;
}

function decodeCreatedArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CREATE_SERVICE_LIMITS.arguments) {
    throw createInternalError();
  }
  return value.map((item): string => {
    // An empty argument is a real argument, so only the bounds and the
    // character rules apply.
    if (
      typeof item !== "string" ||
      new TextEncoder().encode(item).length >
        CREATE_SERVICE_LIMITS.argumentBytes ||
      hasForbiddenTextCharacters(item)
    ) {
      throw createInternalError();
    }
    return item;
  });
}

function decodeBooleanField(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInternalError();
  return value;
}

function decodeNotes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw createInternalError();
  }
  return value.map((note) => decodeBoundedText(note, 1024));
}

export function decodeCreateServicePreview(
  value: unknown,
): CreateServicePreview {
  const write = decodeResourceWritePreview(value);
  if (!isRecord(value)) throw createInternalError();
  // The backend never returns environment values, and neither do we accept any.
  if (value.environment !== undefined || value.environmentValues !== undefined) {
    throw createInternalError();
  }
  const label = decodeCreatedLabel(value.label);
  const filePath = createdServiceFilePath(label);
  if (
    write.kind !== "CREATE" ||
    write.target !== filePath ||
    value.filePath !== filePath ||
    !write.diff.redacted ||
    write.diff.lines.length > 0
  ) {
    throw createInternalError();
  }
  const workingDirectory = decodeOptionalDisplayPath(value.workingDirectory);
  const stdoutPath = decodeOptionalDisplayPath(value.stdoutPath);
  const stderrPath = decodeOptionalDisplayPath(value.stderrPath);
  return {
    ...write,
    label,
    filePath,
    executable: decodeDisplayPath(value.executable),
    arguments: decodeCreatedArguments(value.arguments),
    argumentsRedacted: decodeBooleanField(value.argumentsRedacted),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    environmentKeys: decodeEnvironmentKeys(value.environmentKeys),
    ...(stdoutPath === undefined ? {} : { stdoutPath }),
    ...(stderrPath === undefined ? {} : { stderrPath }),
    runAtLoad: decodeBooleanField(value.runAtLoad),
    keepAlive: decodeBooleanField(value.keepAlive),
    persistenceNotes: decodeNotes(value.persistenceNotes),
    effectNote: decodeBoundedText(value.effectNote, 1024),
  };
}

export function decodeCreateServiceExecution(
  value: unknown,
): CreateServiceExecution {
  const execution = decodeResourceWriteExecution(value);
  if (!isRecord(value)) throw createInternalError();
  const label = decodeCreatedLabel(value.label);
  const filePath = createdServiceFilePath(label);
  // Creating the file never loads the job; a result that says otherwise is not trusted.
  if (value.filePath !== filePath || value.loaded !== false) {
    throw createInternalError();
  }
  return {
    ...execution,
    label,
    filePath,
    loaded: false,
    effectNote: decodeBoundedText(value.effectNote, 1024),
  };
}

function invalidCreateRequest(): AppError {
  // Deliberately generic: the request may hold secrets.
  return {
    code: "INVALID_INPUT",
    message: "The launchd job request is not valid.",
    retryable: false,
  };
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function createPayload(request: CreateServiceRequest): Record<string, unknown> {
  const optional = (value: unknown): value is string | undefined =>
    value === undefined || isText(value);
  if (
    !isRecord(request) ||
    !isText(request.label) ||
    request.label.length === 0 ||
    !isText(request.executable) ||
    request.executable.length === 0 ||
    !Array.isArray(request.arguments) ||
    !request.arguments.every(isText) ||
    !isRecord(request.environment) ||
    !Object.values(request.environment).every(isText) ||
    !optional(request.workingDirectory) ||
    !optional(request.stdoutPath) ||
    !optional(request.stderrPath) ||
    typeof request.runAtLoad !== "boolean" ||
    typeof request.keepAlive !== "boolean"
  ) {
    throw invalidCreateRequest();
  }
  return {
    label: request.label,
    executable: request.executable,
    arguments: [...request.arguments],
    ...(request.workingDirectory === undefined
      ? {}
      : { workingDirectory: request.workingDirectory }),
    environment: { ...request.environment },
    ...(request.stdoutPath === undefined ? {} : { stdoutPath: request.stdoutPath }),
    ...(request.stderrPath === undefined ? {} : { stderrPath: request.stderrPath }),
    runAtLoad: request.runAtLoad,
    keepAlive: request.keepAlive,
  };
}

/** Previews creating one job; writes nothing. */
export function previewCreateLaunchdService(
  request: CreateServiceRequest,
): Promise<CreateServicePreview> {
  let input: Record<string, unknown>;
  try {
    input = createPayload(request);
  } catch (error) {
    return Promise.reject(error);
  }
  return invokeCommand(
    "preview_create_launchd_service",
    decodeCreateServicePreview,
    { input },
  );
}

/** Confirms a creation preview by its operation id only. */
export function executeCreateLaunchdService(
  operationId: string,
): Promise<CreateServiceExecution> {
  if (typeof operationId !== "string" || operationId.length === 0) {
    return Promise.reject({
      code: "INVALID_INPUT",
      message: "Operation id is invalid.",
      retryable: false,
    } satisfies AppError);
  }
  return invokeCommand(
    "execute_create_launchd_service",
    decodeCreateServiceExecution,
    { operationId },
  );
}

// Lifecycle actions on one modifiable launchd job. The request is an action, a
// domain and a label: no path, uid or launchctl argument. The backend
// rediscovers the job and judges its ownership again on every preview and every
// confirmation, then reads the real state back after the command.

export const LAUNCHD_ACTIONS = [
  "LOAD",
  "START",
  "STOP",
  "RESTART",
  "DISABLE",
  "ENABLE",
  "UNLOAD",
] as const;
export type LaunchdAction = (typeof LAUNCHD_ACTIONS)[number];

export const LAUNCHD_ACTION_OUTCOMES = [
  "SUCCEEDED",
  "NO_CHANGE",
  "PARTIAL",
  "FAILED",
  "UNKNOWN",
  "CANCELLED",
] as const;
export type LaunchdActionOutcome = (typeof LAUNCHD_ACTION_OUTCOMES)[number];

export const LAUNCHD_STEP_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "NOT_RUN",
] as const;
export type LaunchdStepStatus = (typeof LAUNCHD_STEP_STATUSES)[number];

export interface LaunchdActionRequest {
  action: LaunchdAction;
  /** Only the current user's session domain can be acted on. */
  domain: "GUI";
  label: string;
}

/** A part that is absent could not be read; it never means "no". */
export interface LaunchdObservedState {
  loaded?: boolean;
  running?: boolean;
  pid?: number;
  /** The login auto-start override; no override means enabled. */
  disabled?: boolean;
}

export interface LaunchdExpectation {
  loaded?: boolean;
  running?: boolean;
  disabled?: boolean;
}

export interface LaunchdActionPreview extends OperationPreview {
  action: LaunchdAction;
  domain: "GUI";
  label: string;
  /** What the action really does to launchd. */
  meaning: string[];
  /** What survives a logout or reboot. */
  persistence: string[];
  /** The exact commands that will run; empty when nothing needs to run. */
  commands: string[];
  current: LaunchdObservedState;
  keepAlive: boolean;
  noChange: boolean;
}

export interface LaunchdActionStep {
  command: string;
  status: LaunchdStepStatus;
  exitCode?: number;
  detail?: string;
}

export interface LaunchdActionExecution {
  operation: OperationDetails;
  action: LaunchdAction;
  domain: "GUI";
  label: string;
  outcome: LaunchdActionOutcome;
  message: string;
  steps: LaunchdActionStep[];
  expected: LaunchdExpectation;
  observed: LaunchdObservedState;
  cancelRequested: boolean;
}

const MAX_ACTION_TEXTS = 8;
const MAX_ACTION_STEPS = 4;
const MAX_ACTION_TEXT_BYTES = 1024;
const MAX_LABEL_BYTES = 255;
const MAX_EXIT_CODE = 255;

export function isValidLaunchdLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_LABEL_BYTES &&
    !value.startsWith("-") &&
    !/[\s/]/u.test(value) &&
    !hasForbiddenTextCharacters(value)
  );
}

function decodeActionLabel(value: unknown): string {
  if (!isValidLaunchdLabel(value)) throw createInternalError();
  return value;
}

function decodeGuiDomain(value: unknown): "GUI" {
  if (value !== "GUI") throw createInternalError();
  return "GUI";
}

function decodeActionTexts(value: unknown, min: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > MAX_ACTION_TEXTS
  ) {
    throw createInternalError();
  }
  return value.map((text) => decodeBoundedText(text, MAX_ACTION_TEXT_BYTES));
}

function decodeActionCommands(value: unknown): string[] {
  const commands = decodeActionTexts(value, 0);
  // Only launchctl commands for the user's own session domain are ever shown.
  if (
    commands.length > 1 ||
    commands.some((command) => !/^launchctl (bootstrap|bootout|kickstart|kill|enable|disable) /u.test(command))
  ) {
    throw createInternalError();
  }
  return commands;
}

function decodeObservedState(value: unknown): LaunchdObservedState {
  if (!isRecord(value)) throw createInternalError();
  const loaded = decodeOptionalBoolean(value.loaded);
  const running = decodeOptionalBoolean(value.running);
  const pid = decodeOptionalCount(value.pid);
  const disabled = decodeOptionalBoolean(value.disabled);
  // A process can only exist for a job that is loaded and running.
  if (
    (running === true && loaded !== true) ||
    (loaded === false && running === true) ||
    (pid !== undefined && running !== true)
  ) {
    throw createInternalError();
  }
  return {
    ...(loaded === undefined ? {} : { loaded }),
    ...(running === undefined ? {} : { running }),
    ...(pid === undefined ? {} : { pid }),
    ...(disabled === undefined ? {} : { disabled }),
  };
}

function decodeExpectation(value: unknown): LaunchdExpectation {
  if (!isRecord(value)) throw createInternalError();
  const loaded = decodeOptionalBoolean(value.loaded);
  const running = decodeOptionalBoolean(value.running);
  const disabled = decodeOptionalBoolean(value.disabled);
  return {
    ...(loaded === undefined ? {} : { loaded }),
    ...(running === undefined ? {} : { running }),
    ...(disabled === undefined ? {} : { disabled }),
  };
}

export function decodeLaunchdActionPreview(
  value: unknown,
): LaunchdActionPreview {
  const operation = decodeOperationPreview(value);
  if (!isRecord(value)) throw createInternalError();
  const commands = decodeActionCommands(value.commands);
  const noChange = decodeBoolean(value.noChange);
  // Nothing to run exactly when nothing changes.
  if (noChange !== (commands.length === 0)) {
    throw createInternalError();
  }
  return {
    ...operation,
    action: oneOf(value.action, LAUNCHD_ACTIONS),
    domain: decodeGuiDomain(value.domain),
    label: decodeActionLabel(value.label),
    meaning: decodeActionTexts(value.meaning, 1),
    persistence: decodeActionTexts(value.persistence, 1),
    commands,
    current: decodeObservedState(value.current),
    keepAlive: decodeBoolean(value.keepAlive),
    noChange,
  };
}

function decodeActionStep(value: unknown): LaunchdActionStep {
  if (!isRecord(value)) throw createInternalError();
  const status = oneOf(value.status, LAUNCHD_STEP_STATUSES);
  const exitCode = decodeOptionalCount(value.exitCode);
  if (exitCode !== undefined && exitCode > MAX_EXIT_CODE) {
    throw createInternalError();
  }
  const detail =
    value.detail === undefined || value.detail === null
      ? undefined
      : decodeBoundedText(value.detail, MAX_ACTION_TEXT_BYTES);
  return {
    command: decodeBoundedText(value.command, MAX_ACTION_TEXT_BYTES),
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function matchesExpectation(
  expected: LaunchdExpectation,
  observed: LaunchdObservedState,
): boolean {
  return (["loaded", "running", "disabled"] as const).every(
    (key) => expected[key] === undefined || observed[key] === expected[key],
  );
}

export function decodeLaunchdActionExecution(
  value: unknown,
): LaunchdActionExecution {
  if (!isRecord(value)) throw createInternalError();
  const operation = decodeOperationDetails(value.operation);
  const outcome = oneOf(value.outcome, LAUNCHD_ACTION_OUTCOMES);
  const steps = decodeList(value.steps, MAX_ACTION_STEPS, decodeActionStep);
  const expected = decodeExpectation(value.expected);
  const observed = decodeObservedState(value.observed);
  const allSucceeded =
    steps.length > 0 && steps.every((step) => step.status === "SUCCEEDED");

  // The outcome must agree with everything else the payload shows, and "done"
  // is only believable when the state that was read back is the promised one.
  // Anything contradictory fails closed instead of showing a success.
  const consistent =
    outcome === "SUCCEEDED"
      ? allSucceeded &&
        operation.status === "SUCCEEDED" &&
        matchesExpectation(expected, observed)
      : outcome === "NO_CHANGE"
        ? steps.length === 0 && operation.status === "SUCCEEDED"
        : outcome === "CANCELLED"
          ? operation.status === "CANCELLED" &&
            steps.every((step) => step.status === "NOT_RUN")
          : operation.status === "FAILED" &&
            (outcome !== "UNKNOWN" || !matchesExpectation(expected, observed));
  if (!consistent) throw createInternalError();

  return {
    operation,
    action: oneOf(value.action, LAUNCHD_ACTIONS),
    domain: decodeGuiDomain(value.domain),
    label: decodeActionLabel(value.label),
    outcome,
    message: decodeBoundedText(value.message, MAX_ACTION_TEXT_BYTES),
    steps,
    expected,
    observed,
    cancelRequested: decodeBoolean(value.cancelRequested),
  };
}

function invalidActionRequest(): AppError {
  return {
    code: "INVALID_INPUT",
    message: "The launchd action request is not valid.",
    retryable: false,
  };
}

/** Exactly `{action, domain, label}`; anything else the caller adds is dropped. */
function launchdActionPayload(
  request: LaunchdActionRequest,
): LaunchdActionRequest {
  if (
    !isRecord(request) ||
    !(LAUNCHD_ACTIONS as readonly unknown[]).includes(request.action) ||
    request.domain !== "GUI" ||
    !isValidLaunchdLabel(request.label)
  ) {
    throw invalidActionRequest();
  }
  return {
    action: request.action,
    domain: "GUI",
    label: request.label,
  };
}

/** Previews one lifecycle action; runs nothing. */
export function previewLaunchdAction(
  request: LaunchdActionRequest,
): Promise<LaunchdActionPreview> {
  let input: LaunchdActionRequest;
  try {
    input = launchdActionPayload(request);
  } catch (error) {
    return Promise.reject(error);
  }
  return invokeCommand(
    "preview_launchd_action",
    (value) => {
      const preview = decodeLaunchdActionPreview(value);
      // A preview for another job or action than the one asked for is not trusted.
      if (preview.action !== input.action || preview.label !== input.label) {
        throw createInternalError();
      }
      return preview;
    },
    { input },
  );
}

/** Confirms a lifecycle preview by its operation id only. */
export function executeLaunchdAction(
  operationId: string,
): Promise<LaunchdActionExecution> {
  if (typeof operationId !== "string" || operationId.length === 0) {
    return Promise.reject({
      code: "INVALID_INPUT",
      message: "Operation id is invalid.",
      retryable: false,
    } satisfies AppError);
  }
  return invokeCommand(
    "execute_launchd_action",
    (value) => {
      const execution = decodeLaunchdActionExecution(value);
      if (execution.operation.operationId !== operationId) {
        throw createInternalError();
      }
      return execution;
    },
    { operationId },
  );
}

export const LOG_STREAMS = ["STDOUT", "STDERR"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

export const LOG_STATES = ["CONTENT", "MISSING"] as const;
export type LogState = (typeof LOG_STATES)[number];

export const LOG_RESETS = ["REPLACED", "TRUNCATED"] as const;
export type LogReset = (typeof LOG_RESETS)[number];

/** One tail read is at most 1 MiB; replacement characters can enlarge it. */
const MAX_LOG_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_LOG_GRANT_ID_LENGTH = 64;
const MAX_LOG_REQUEST_BYTES = 1024 * 1024;

export interface LogTarget {
  domain: LaunchdDomain;
  label: string;
  stream: LogStream;
}

export interface LogIdentity {
  device: number;
  inode: number;
}

/** Where the next incremental read continues; the backend checks the identity. */
export interface LogCursor extends LogIdentity {
  offset: number;
}

/** What may be shown about an authorization: an id and the `~` display path. */
export interface LogGrantSummary {
  grantId: string;
  displayPath: string;
}

export interface LogSnapshot {
  state: LogState;
  text: string;
  skippedBytes: number;
  headTrimmed: boolean;
  lossy: boolean;
  reset: LogReset | null;
  nextOffset: number;
  fileSize: number;
  identity: LogIdentity | null;
}

export interface LogExportPreview {
  operationId: string;
  expiresAt: string;
  replaces: boolean;
  save: LogGrantSummary;
}

function invalidLogRequest(): AppError {
  return {
    code: "INVALID_INPUT",
    message: "The log request is not valid.",
    retryable: false,
  };
}

function decodeLogGrantId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LOG_GRANT_ID_LENGTH
  ) {
    throw invalidLogRequest();
  }
  return value;
}

function decodeSafeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createInternalError();
  }
  return value;
}

function decodeLogIdentity(value: unknown): LogIdentity {
  if (!isRecord(value)) throw createInternalError();
  return {
    device: decodeSafeCount(value.device),
    inode: decodeSafeCount(value.inode),
  };
}

/** Exactly the fields the backend expects; a path, if a caller adds one, is dropped. */
function logTargetPayload(target: LogTarget): LogTarget {
  if (
    !isRecord(target) ||
    (target.domain !== "GUI" && target.domain !== "SYSTEM") ||
    !isValidLaunchdLabel(target.label) ||
    !(LOG_STREAMS as readonly unknown[]).includes(target.stream)
  ) {
    throw invalidLogRequest();
  }
  return {
    domain: target.domain,
    label: target.label,
    stream: target.stream,
  };
}

function rejectLog<T>(error: unknown): Promise<T> {
  return Promise.reject(error);
}

export function decodeLogGrantSummary(value: unknown): LogGrantSummary {
  if (!isRecord(value)) throw createInternalError();
  return {
    grantId: decodeLogGrantId(value.grantId),
    displayPath: decodeLaunchdNonEmptyText(value.displayPath),
  };
}

/**
 * A snapshot is trusted only when its parts agree: a file that exists carries
 * an identity, a missing one carries none and no text.
 */
export function decodeLogSnapshot(value: unknown): LogSnapshot {
  if (!isRecord(value)) throw createInternalError();
  const state = oneOf(value.state, LOG_STATES);
  if (
    typeof value.text !== "string" ||
    new TextEncoder().encode(value.text).length > MAX_LOG_TEXT_BYTES ||
    typeof value.headTrimmed !== "boolean" ||
    typeof value.lossy !== "boolean"
  ) {
    throw createInternalError();
  }
  const reset =
    value.reset === undefined || value.reset === null
      ? null
      : oneOf(value.reset, LOG_RESETS);
  const identity =
    value.identity === undefined || value.identity === null
      ? null
      : decodeLogIdentity(value.identity);
  if (state === "MISSING") {
    if (value.text !== "" || identity !== null || reset !== null) {
      throw createInternalError();
    }
  } else if (identity === null) {
    throw createInternalError();
  }
  return {
    state,
    text: value.text,
    skippedBytes: decodeSafeCount(value.skippedBytes),
    headTrimmed: value.headTrimmed,
    lossy: value.lossy,
    reset,
    nextOffset: decodeSafeCount(value.nextOffset),
    fileSize: decodeSafeCount(value.fileSize),
    identity,
  };
}

export function decodeLogExportPreview(value: unknown): LogExportPreview {
  if (!isRecord(value) || typeof value.replaces !== "boolean") {
    throw createInternalError();
  }
  return {
    operationId: decodeLaunchdNonEmptyText(value.operationId),
    expiresAt: decodeLaunchdNonEmptyText(value.expiresAt),
    replaces: value.replaces,
    save: decodeLogGrantSummary(value.save),
  };
}

/** Asks for the file the plist declares; `null` means the picker was cancelled. */
export function authorizeLaunchdLog(
  target: LogTarget,
): Promise<LogGrantSummary | null> {
  let input: LogTarget;
  try {
    input = logTargetPayload(target);
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand(
    "authorize_launchd_log",
    (value) => (value === null ? null : decodeLogGrantSummary(value)),
    { target: input },
  );
}

export function revokeLaunchdLog(grantId: string): Promise<void> {
  let id: string;
  try {
    id = decodeLogGrantId(grantId);
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand("revoke_launchd_log", () => undefined, {
    input: { grantId: id },
  });
}

export function readLaunchdLogTail(
  target: LogTarget,
  grantId: string,
  maxBytes?: number,
): Promise<LogSnapshot> {
  let input: { target: LogTarget; grantId: string; maxBytes?: number };
  try {
    if (
      maxBytes !== undefined &&
      (!Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > MAX_LOG_REQUEST_BYTES)
    ) {
      throw invalidLogRequest();
    }
    input = {
      target: logTargetPayload(target),
      grantId: decodeLogGrantId(grantId),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    };
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand("read_launchd_log_tail", decodeLogSnapshot, {
    input,
  });
}

export function readLaunchdLogSince(
  target: LogTarget,
  grantId: string,
  cursor: LogCursor,
): Promise<LogSnapshot> {
  let input: LogSinceInput;
  try {
    input = {
      target: logTargetPayload(target),
      grantId: decodeLogGrantId(grantId),
      offset: decodeSafeCount(cursor.offset),
      device: decodeSafeCount(cursor.device),
      inode: decodeSafeCount(cursor.inode),
    };
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand("read_launchd_log_since", decodeLogSnapshot, {
    input,
  });
}

interface LogSinceInput {
  target: LogTarget;
  grantId: string;
  offset: number;
  device: number;
  inode: number;
}

export function prepareLaunchdLogExport(
  target: LogTarget,
  grantId: string,
): Promise<LogExportPreview | null> {
  let input: { target: LogTarget; grantId: string };
  try {
    input = {
      target: logTargetPayload(target),
      grantId: decodeLogGrantId(grantId),
    };
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand(
    "prepare_launchd_log_export",
    (value) => (value === null ? null : decodeLogExportPreview(value)),
    { input },
  );
}

/** Confirms a previewed export; the outcome says whether the file was written. */
export function confirmLaunchdLogExport(
  operationId: string,
  grantId: string,
): Promise<WriteOutcome> {
  let input: { operationId: string; grantId: string };
  try {
    input = {
      operationId: decodeLaunchdNonEmptyText(operationId),
      grantId: decodeLogGrantId(grantId),
    };
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand("confirm_launchd_log_export", decodeWriteOutcome, {
    input,
  });
}

export function discardLaunchdLogExport(
  operationId: string,
  grantId: string,
): Promise<void> {
  let input: { operationId: string; grantId: string };
  try {
    input = {
      operationId: decodeLaunchdNonEmptyText(operationId),
      grantId: decodeLogGrantId(grantId),
    };
  } catch (error) {
    return rejectLog(error);
  }
  return invokeCommand("discard_launchd_log_export", () => undefined, {
    input,
  });
}
