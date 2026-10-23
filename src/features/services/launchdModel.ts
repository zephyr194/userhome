import type { AppError } from "../../ipc/core";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { localizedErrorMessage } from "../../i18n/errors";
import type {
  LaunchdConfigFile,
  LaunchdCorrelation,
  LaunchdDiscovery,
  LaunchdDomain,
  LaunchdFileKind,
  LaunchdKeepAliveMode,
  LaunchdEvidence,
  LaunchdLastExit,
  LaunchdLinkState,
  LaunchdOwnershipKind,
  LaunchdParseStatus,
  LaunchdReadOnlyReason,
  LaunchdScope,
  LaunchdService,
  LaunchdSource,
  LaunchdSourceReason,
  LaunchdSourceReport,
  LaunchdSourceStatus,
  ServiceSummary,
} from "../../ipc/services";

// ---- labels -----------------------------------------------------------------

/** Where the definition sits, by directory only; never an ownership verdict. */
const SCOPE_KEYS: Record<LaunchdScope, MessageKey> = {
  USER_AGENT: "services.scope.userAgent",
  GLOBAL_AGENT: "services.scope.globalAgent",
  SYSTEM_DAEMON: "services.scope.systemDaemon",
  APPLE_AGENT: "services.scope.appleAgent",
  APPLE_DAEMON: "services.scope.appleDaemon",
  MIXED: "services.scope.mixed",
  UNATTRIBUTED: "services.scope.unattributed",
};

export function scopeLabel(scope: LaunchdScope, t: TranslateFunction): string {
  return t(SCOPE_KEYS[scope]);
}

// ---- ownership ----------------------------------------------------------------
// Ownership is the backend's judgement from the file owner, file type, location
// and label. It is not the directory-based "source" above, and the two are
// shown and filtered separately.

const OWNERSHIP_LABEL_KEYS: Record<LaunchdOwnershipKind, MessageKey> = {
  CURRENT_USER_AGENT: "services.ownershipKind.currentUserAgent",
  GLOBAL_AGENT: "services.ownershipKind.globalAgent",
  SYSTEM_DAEMON: "services.ownershipKind.systemDaemon",
  APPLE_MANAGED: "services.ownershipKind.appleManaged",
  THIRD_PARTY: "services.ownershipKind.thirdParty",
  USERHOME_CREATED: "services.ownershipKind.userhomeCreated",
  USERHOME_ADOPTED: "services.ownershipKind.userhomeAdopted",
};

export function ownershipLabel(kind: LaunchdOwnershipKind, t: TranslateFunction): string {
  return t(OWNERSHIP_LABEL_KEYS[kind]);
}

const OWNERSHIP_DESCRIPTION_KEYS: Record<LaunchdOwnershipKind, MessageKey> = {
  CURRENT_USER_AGENT: "services.ownershipDesc.currentUserAgent",
  GLOBAL_AGENT: "services.ownershipDesc.globalAgent",
  SYSTEM_DAEMON: "services.ownershipDesc.systemDaemon",
  APPLE_MANAGED: "services.ownershipDesc.appleManaged",
  THIRD_PARTY: "services.ownershipDesc.thirdParty",
  USERHOME_CREATED: "services.ownershipDesc.userhomeCreated",
  USERHOME_ADOPTED: "services.ownershipDesc.userhomeAdopted",
};

export function ownershipDescription(kind: LaunchdOwnershipKind, t: TranslateFunction): string {
  return t(OWNERSHIP_DESCRIPTION_KEYS[kind]);
}

const READ_ONLY_REASON_KEYS: Record<LaunchdReadOnlyReason, MessageKey> = {
  APPLE_MANAGED: "services.readOnly.appleManaged",
  SYSTEM_DAEMON_LOCATION: "services.readOnly.systemDaemonLocation",
  GLOBAL_AGENT_LOCATION: "services.readOnly.globalAgentLocation",
  NOT_ADOPTED: "services.readOnly.notAdopted",
  NO_CONFIG_FILE: "services.readOnly.noConfigFile",
  SYMBOLIC_LINK: "services.readOnly.symbolicLink",
  LINK_TARGET_OUTSIDE: "services.readOnly.linkTargetOutside",
  OWNER_NOT_CURRENT_USER: "services.readOnly.ownerNotCurrentUser",
  OWNER_UNKNOWN: "services.readOnly.ownerUnknown",
  PLIST_NOT_PARSED: "services.readOnly.plistNotParsed",
  LABEL_NOT_FROM_PLIST: "services.readOnly.labelNotFromPlist",
  LABEL_FILENAME_MISMATCH: "services.readOnly.labelFilenameMismatch",
  DUPLICATE_DEFINITION: "services.readOnly.duplicateDefinition",
  UNAPPROVED_LOCATION: "services.readOnly.unapprovedLocation",
  DISCOVERY_INCOMPLETE: "services.readOnly.discoveryIncomplete",
};

export function readOnlyReasonText(reason: LaunchdReadOnlyReason, t: TranslateFunction): string {
  return t(READ_ONLY_REASON_KEYS[reason]);
}

const EVIDENCE_KEYS: Record<LaunchdEvidence, MessageKey> = {
  LABEL_APPLE_NAMESPACE: "services.evidence.labelAppleNamespace",
  APPLE_PATH: "services.evidence.applePath",
  LABEL_USERHOME_NAMESPACE: "services.evidence.labelUserhomeNamespace",
  ADOPTION_RECORD: "services.evidence.adoptionRecord",
  DOMAIN_GUI: "services.evidence.domainGui",
  DOMAIN_SYSTEM: "services.evidence.domainSystem",
  IN_USER_LAUNCH_AGENTS: "services.evidence.inUserLaunchAgents",
  IN_GLOBAL_LAUNCH_AGENTS: "services.evidence.inGlobalLaunchAgents",
  IN_GLOBAL_LAUNCH_DAEMONS: "services.evidence.inGlobalLaunchDaemons",
  OWNER_CURRENT_USER: "services.evidence.ownerCurrentUser",
  OWNER_OTHER_USER: "services.evidence.ownerOtherUser",
  OWNER_UNKNOWN: "services.evidence.ownerUnknown",
  REGULAR_FILE: "services.evidence.regularFile",
  SYMBOLIC_LINK: "services.evidence.symbolicLink",
  NO_CONFIG_FILE: "services.evidence.noConfigFile",
};

export function evidenceText(evidence: LaunchdEvidence, t: TranslateFunction): string {
  return t(EVIDENCE_KEYS[evidence]);
}

export interface OwnershipSummary {
  kind: LaunchdOwnershipKind;
  label: string;
  description: string;
  modifiable: boolean;
  badge: string;
  reasons: string[];
  evidence: string[];
  note: string;
}

export function ownershipSummary(service: LaunchdService, t: TranslateFunction): OwnershipSummary {
  const { ownership } = service;
  return {
    kind: ownership.kind,
    label: ownershipLabel(ownership.kind, t),
    description: ownershipDescription(ownership.kind, t),
    modifiable: ownership.modifiable,
    badge: ownership.modifiable
      ? t("services.ownership.badgeModifiable")
      : t("services.ownership.badgeReadOnly"),
    reasons: ownership.readOnlyReasons.map((reason) => readOnlyReasonText(reason, t)),
    evidence: ownership.evidence.map((evidence) => evidenceText(evidence, t)),
    note: ownership.modifiable
      ? t("services.ownership.noteModifiable")
      : t("services.ownership.noteReadOnly"),
  };
}

const DOMAIN_KEYS: Record<LaunchdDomain, MessageKey> = {
  GUI: "services.domain.gui",
  SYSTEM: "services.domain.system",
};

export function domainLabel(domain: LaunchdDomain, t: TranslateFunction): string {
  return t(DOMAIN_KEYS[domain]);
}

const LAUNCHCTL_SOURCE_KEYS: Partial<Record<LaunchdSource, MessageKey>> = {
  LAUNCHCTL_LIST: "services.source.launchctlList",
  LAUNCHCTL_PRINT_SYSTEM: "services.source.launchctlPrintSystem",
};

const SOURCE_PATH_LABELS: Partial<Record<LaunchdSource, string>> = {
  USER_LAUNCH_AGENTS: "~/Library/LaunchAgents",
  GLOBAL_LAUNCH_AGENTS: "/Library/LaunchAgents",
  GLOBAL_LAUNCH_DAEMONS: "/Library/LaunchDaemons",
  APPLE_LAUNCH_AGENTS: "/System/Library/LaunchAgents",
  APPLE_LAUNCH_DAEMONS: "/System/Library/LaunchDaemons",
};

export function sourceLabel(source: LaunchdSource, t: TranslateFunction): string {
  const key = LAUNCHCTL_SOURCE_KEYS[source];
  if (key !== undefined) return t(key);
  return SOURCE_PATH_LABELS[source] ?? source;
}

const SOURCE_STATUS_KEYS: Record<LaunchdSourceStatus, MessageKey> = {
  COMPLETE: "services.sourceStatus.complete",
  PARTIAL: "services.sourceStatus.partial",
  INACCESSIBLE: "services.sourceStatus.inaccessible",
  FAILED: "services.sourceStatus.failed",
};

export function sourceStatusLabel(status: LaunchdSourceStatus, t: TranslateFunction): string {
  return t(SOURCE_STATUS_KEYS[status]);
}

const SOURCE_REASON_KEYS: Record<LaunchdSourceReason, MessageKey> = {
  TIMEOUT: "services.sourceReason.timeout",
  OUTPUT_TOO_LARGE: "services.sourceReason.outputTooLarge",
  PROCESS_FAILED: "services.sourceReason.processFailed",
  PERMISSION_DENIED: "services.sourceReason.permissionDenied",
  TOOL_UNAVAILABLE: "services.sourceReason.toolUnavailable",
  UNPARSED_OUTPUT: "services.sourceReason.unparsedOutput",
  ENTRY_LIMIT: "services.sourceReason.entryLimit",
  DIRECTORY_MISSING: "services.sourceReason.directoryMissing",
  OUTSIDE_HOME: "services.sourceReason.outsideHome",
  HOME_UNAVAILABLE: "services.sourceReason.homeUnavailable",
  IO: "services.sourceReason.io",
  FILE_ERRORS: "services.sourceReason.fileErrors",
  TIME_BUDGET: "services.sourceReason.timeBudget",
};

export function sourceReasonText(reason: LaunchdSourceReason, t: TranslateFunction): string {
  return t(SOURCE_REASON_KEYS[reason]);
}

const PARSE_STATUS_KEYS: Record<LaunchdParseStatus, MessageKey> = {
  PARSED: "services.parse.parsed",
  CONVERT_FAILED: "services.parse.convertFailed",
  TOO_LARGE: "services.parse.tooLarge",
  LINK_NOT_READ: "services.parse.linkNotRead",
  UNREADABLE: "services.parse.unreadable",
  TIMED_OUT: "services.parse.timedOut",
  OUTPUT_TOO_LARGE: "services.parse.outputTooLarge",
  TOOL_UNAVAILABLE: "services.parse.toolUnavailable",
  NOT_ATTEMPTED: "services.parse.notAttempted",
};

export function parseStatusText(status: LaunchdParseStatus, t: TranslateFunction): string {
  return t(PARSE_STATUS_KEYS[status]);
}

const FILE_KIND_KEYS: Record<LaunchdFileKind, MessageKey> = {
  REGULAR: "services.fileKind.regular",
  LINK: "services.fileKind.link",
};

export function fileKindText(kind: LaunchdFileKind, t: TranslateFunction): string {
  return t(FILE_KIND_KEYS[kind]);
}

const LINK_STATE_KEYS: Record<LaunchdLinkState, MessageKey> = {
  INSIDE: "services.linkState.inside",
  OUTSIDE: "services.linkState.outside",
  UNRESOLVED: "services.linkState.unresolved",
};

export function linkStateText(state: LaunchdLinkState, t: TranslateFunction): string {
  return t(LINK_STATE_KEYS[state]);
}

const KEEP_ALIVE_KEYS: Record<LaunchdKeepAliveMode, MessageKey> = {
  ALWAYS: "services.keepAlive.always",
  NEVER: "services.keepAlive.never",
  CONDITIONAL: "services.keepAlive.conditional",
};

export function keepAliveText(mode: LaunchdKeepAliveMode, t: TranslateFunction): string {
  return t(KEEP_ALIVE_KEYS[mode]);
}

const ISSUE_KEYS: Record<LaunchdService["issues"][number], MessageKey> = {
  DUPLICATE_LABEL: "services.issue.duplicateLabel",
  DUPLICATE_LOADED_LABEL: "services.issue.duplicateLoadedLabel",
  LABEL_FILENAME_MISMATCH: "services.issue.labelFilenameMismatch",
  MISSING_LABEL: "services.issue.missingLabel",
  INVALID_LABEL: "services.issue.invalidLabel",
};

export function issueText(issue: LaunchdService["issues"][number], t: TranslateFunction): string {
  return t(ISSUE_KEYS[issue]);
}

export function exitText(lastExit: LaunchdLastExit | undefined, t: TranslateFunction): string {
  if (lastExit === undefined) return t("services.exit.none");
  return lastExit.kind === "SIGNAL"
    ? t("services.exit.signal", { value: lastExit.value })
    : t("services.exit.code", { value: lastExit.value });
}

// ---- status -------------------------------------------------------------------

export const STATUS_CATEGORIES = [
  "RUNNING",
  "LOADED_IDLE",
  "NOT_LOADED",
  "UNKNOWN",
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

const STATUS_CATEGORY_KEYS: Record<StatusCategory, MessageKey> = {
  RUNNING: "services.status.running",
  LOADED_IDLE: "services.status.loadedIdle",
  NOT_LOADED: "services.status.notLoaded",
  UNKNOWN: "services.status.unknown",
};

export function statusCategoryLabel(category: StatusCategory, t: TranslateFunction): string {
  return t(STATUS_CATEGORY_KEYS[category]);
}

export function statusCategory(service: LaunchdService): StatusCategory {
  if (service.loadState === "LOADED") {
    if (service.runState === "RUNNING") return "RUNNING";
    if (service.runState === "NOT_RUNNING") return "LOADED_IDLE";
    return "UNKNOWN";
  }
  return service.loadState === "NOT_LOADED" ? "NOT_LOADED" : "UNKNOWN";
}

export type StatusTone = "neutral" | "success" | "warning" | "danger";

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
  detail: string;
}

/** A stopped job and a non-zero exit are facts, not errors; there is no danger tone. */
export function statusPresentation(service: LaunchdService, t: TranslateFunction): StatusPresentation {
  switch (statusCategory(service)) {
    case "RUNNING":
      return {
        label: statusCategoryLabel("RUNNING", t),
        tone: "success",
        detail: t("services.statusDetail.running"),
      };
    case "LOADED_IDLE":
      return {
        label: statusCategoryLabel("LOADED_IDLE", t),
        tone: "neutral",
        detail: t("services.statusDetail.loadedIdle"),
      };
    case "NOT_LOADED":
      return {
        label: statusCategoryLabel("NOT_LOADED", t),
        tone: "neutral",
        detail: t("services.statusDetail.notLoaded"),
      };
    case "UNKNOWN":
      return {
        label: statusCategoryLabel("UNKNOWN", t),
        tone: "warning",
        detail:
          service.loadState === "INACCESSIBLE" ||
          service.runState === "INACCESSIBLE"
            ? t("services.statusDetail.noPermission")
            : t("services.statusDetail.unknown"),
      };
  }
}

const CORRELATION_KEYS: Record<LaunchdCorrelation, MessageKey> = {
  MATCHED: "services.correlation.matched",
  FILE_ONLY: "services.correlation.fileOnly",
  LOADED_ONLY: "services.correlation.loadedOnly",
  UNMATCHED_FILE: "services.correlation.unmatchedFile",
};

export function correlationText(service: LaunchdService, t: TranslateFunction): string {
  if (
    service.correlation === "LOADED_ONLY" &&
    service.configPresence === "UNKNOWN"
  ) {
    return t("services.correlation.loadedUnknownConfig");
  }
  if (service.correlation === "LOADED_ONLY") {
    return t("services.correlation.loadedOnlyWithNote");
  }
  return t(CORRELATION_KEYS[service.correlation]);
}

/** One short line for list rows; the details view has the full explanation. */
export function correlationBrief(service: LaunchdService, t: TranslateFunction): string | undefined {
  switch (service.correlation) {
    case "MATCHED":
      return undefined;
    case "FILE_ONLY":
      return t("services.correlationBrief.fileOnly");
    case "LOADED_ONLY":
      return service.configPresence === "UNKNOWN"
        ? t("services.correlationBrief.loadedUnknownConfig")
        : t("services.correlationBrief.loadedNoConfig");
    case "UNMATCHED_FILE":
      return t("services.correlationBrief.unmatchedFile");
  }
}

// ---- execution ----------------------------------------------------------------

export interface Execution {
  executable?: string;
  arguments: string[];
  truncated: boolean;
}

export function primaryConfigFile(
  service: LaunchdService,
): LaunchdConfigFile | undefined {
  return (
    service.configFiles.find((file) => file.details !== undefined) ??
    service.configFiles[0]
  );
}

/** Arguments arrive already masked by the backend; nothing is reconstructed. */
export function executionOf(service: LaunchdService): Execution | undefined {
  const details = service.configFiles.find(
    (file) => file.details !== undefined,
  )?.details;
  if (details === undefined) return undefined;
  const [first, ...rest] = details.programArguments;
  return {
    ...(details.program !== undefined
      ? { executable: details.program, arguments: rest }
      : first !== undefined
        ? { executable: first, arguments: rest }
        : { arguments: [] }),
    truncated: details.argumentsTruncated,
  };
}

// ---- search and filters -------------------------------------------------------

export interface ServiceFilter {
  query: string;
  /** System services are hidden unless this is set. A view option, not a narrowing filter. */
  showSystem: boolean;
  /** Where the definition sits, by directory. Not the ownership verdict. */
  scope: LaunchdScope | "ALL";
  /** The backend's ownership verdict. */
  ownership: LaunchdOwnershipKind | "ALL";
  domain: LaunchdDomain | "ALL";
  status: StatusCategory | "ALL";
}

export const EMPTY_FILTER: ServiceFilter = {
  query: "",
  showSystem: false,
  scope: "ALL",
  ownership: "ALL",
  domain: "ALL",
  status: "ALL",
};

export function isFilterActive(filter: ServiceFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.scope !== "ALL" ||
    filter.ownership !== "ALL" ||
    filter.domain !== "ALL" ||
    filter.status !== "ALL"
  );
}

function searchFields(service: LaunchdService): string[] {
  const segments = service.label.split(".");
  const shortName = segments[segments.length - 1];
  const fields = [service.label, shortName];
  for (const file of service.configFiles) {
    fields.push(file.path);
    if (file.details?.program) fields.push(file.details.program);
    else if (file.details?.programArguments[0]) {
      fields.push(file.details.programArguments[0]);
    }
  }
  return fields;
}

export function filterServices(
  services: readonly LaunchdService[],
  filter: ServiceFilter,
): LaunchdService[] {
  const query = filter.query.trim().toLocaleLowerCase("zh-CN");
  return services.filter(
    (service) =>
      (filter.showSystem || !isSystemService(service)) &&
      (filter.scope === "ALL" || service.scope === filter.scope) &&
      (filter.ownership === "ALL" ||
        service.ownership.kind === filter.ownership) &&
      (filter.domain === "ALL" || service.domain === filter.domain) &&
      (filter.status === "ALL" || statusCategory(service) === filter.status) &&
      (query === "" ||
        searchFields(service).some((field) =>
          field.toLocaleLowerCase("zh-CN").includes(query),
        )),
  );
}

// ---- stable selection ---------------------------------------------------------

export type SelectionResolution =
  | { kind: "none" }
  | { kind: "found"; service: LaunchdService }
  | { kind: "gone"; id: string };

/** The key is the backend id (domain target + label); labels alone can repeat across domains. */
export function resolveSelection(
  services: readonly LaunchdService[],
  selectedId: string | undefined,
): SelectionResolution {
  if (selectedId === undefined) return { kind: "none" };
  const service = services.find((candidate) => candidate.id === selectedId);
  return service ? { kind: "found", service } : { kind: "gone", id: selectedId };
}

export function moveIndex(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (count <= 0) return undefined;
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return Math.max(current - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

// ---- partial results ----------------------------------------------------------

export interface SourceProblem {
  source: LaunchdSource;
  status: LaunchdSourceStatus;
  reason: string;
}

/** Sources that did not read cleanly; a missing directory is normal and is not one. */
export function problemSources(
  discovery: Pick<LaunchdDiscovery, "sources">,
  t: TranslateFunction,
): SourceProblem[] {
  return sourceProblems(discovery.sources, t);
}

export function sourceProblems(
  reports: readonly LaunchdSourceReport[],
  t: TranslateFunction,
): SourceProblem[] {
  return reports.flatMap((report) => {
    if (report.status === "COMPLETE" && report.failedFiles === 0) return [];
    const parts: string[] = [];
    if (report.reason !== undefined) parts.push(sourceReasonText(report.reason, t));
    if (report.failedFiles > 0) {
      parts.push(t("services.problem.failedFilesAppended", { count: report.failedFiles }));
    }
    return [
      {
        source: report.source,
        status: report.status,
        reason: parts.join("").trim() || t("services.problem.noReason"),
      },
    ];
  });
}

// ---- Homebrew evidence --------------------------------------------------------

const HOMEBREW_LABEL_PREFIX = "homebrew.mxcl.";

/** Homebrew is read on the side; its failure never affects the launchd list. */
export type EvidenceState =
  | { status: "loading" }
  | { status: "ready"; summaries: readonly ServiceSummary[] }
  | { status: "unavailable" };

/** Homebrew only supplements a launchd job whose label it created; it never adds jobs. */
export function evidenceFor(
  service: LaunchdService,
  summaries: readonly ServiceSummary[],
): ServiceSummary | undefined {
  if (!service.label.startsWith(HOMEBREW_LABEL_PREFIX)) return undefined;
  const name = service.label.slice(HOMEBREW_LABEL_PREFIX.length);
  return summaries.find((summary) => summary.serviceId === name);
}

export function isHomebrewLabel(label: string): boolean {
  return label.startsWith(HOMEBREW_LABEL_PREFIX);
}

/** Apple-managed and system-domain jobs; hidden from the default list. */
export function isSystemService(service: LaunchdService): boolean {
  return (
    service.ownership.kind === "APPLE_MANAGED" ||
    service.ownership.kind === "SYSTEM_DAEMON" ||
    service.label.startsWith("com.apple.")
  );
}

// ---- discovery state machine --------------------------------------------------

export type DiscoveryState =
  | { status: "loading" }
  | { status: "error"; error: AppError }
  | {
      status: "ready";
      discovery: LaunchdDiscovery;
      refreshing: boolean;
      /** The last refresh failed; the previous result stays on screen. */
      refreshError?: AppError;
    };

export type DiscoveryAction =
  | { type: "refreshStarted" }
  | { type: "loaded"; discovery: LaunchdDiscovery }
  | { type: "failed"; error: AppError };

export const INITIAL_DISCOVERY_STATE: DiscoveryState = { status: "loading" };

export function discoveryReducer(
  state: DiscoveryState,
  action: DiscoveryAction,
): DiscoveryState {
  switch (action.type) {
    case "refreshStarted":
      return state.status === "ready"
        ? { status: "ready", discovery: state.discovery, refreshing: true }
        : { status: "loading" };
    case "loaded":
      return {
        status: "ready",
        discovery: action.discovery,
        refreshing: false,
      };
    case "failed":
      return state.status === "ready"
        ? {
            status: "ready",
            discovery: state.discovery,
            refreshing: false,
            refreshError: action.error,
          }
        : { status: "error", error: action.error };
  }
}

/** A busy read is a short wait, not a failure of the job list; the page retries once. */
export function discoveryErrorText(error: AppError, t: TranslateFunction): string {
  if (error.code === "CONFLICT") {
    return t("services.discovery.conflict");
  }
  return localizedErrorMessage(error, t);
}

export const DISCOVERY_CONFLICT_RETRY_DELAY_MS = 800;
export const DISCOVERY_REFRESH_MIN_INTERVAL_MS = 2_000;

export function canStartRefresh({
  inFlight,
  lastStartedAt,
  now,
}: {
  inFlight: boolean;
  lastStartedAt: number | undefined;
  now: number;
}): boolean {
  if (inFlight) return false;
  return (
    lastStartedAt === undefined ||
    now - lastStartedAt >= DISCOVERY_REFRESH_MIN_INTERVAL_MS
  );
}
