import type { AppError } from "../../ipc/core";
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
const SCOPE_LABELS: Record<LaunchdScope, string> = {
  USER_AGENT: "用户代理",
  GLOBAL_AGENT: "全局代理",
  SYSTEM_DAEMON: "系统 daemon",
  APPLE_AGENT: "Apple 路径代理",
  APPLE_DAEMON: "Apple 路径 daemon",
  MIXED: "多处定义",
  UNATTRIBUTED: "未找到配置文件",
};

export function scopeLabel(scope: LaunchdScope): string {
  return SCOPE_LABELS[scope];
}

// ---- ownership ----------------------------------------------------------------
// Ownership is the backend's judgement from the file owner, file type, location
// and label. It is not the directory-based "source" above, and the two are
// shown and filtered separately.

const OWNERSHIP_LABELS: Record<LaunchdOwnershipKind, string> = {
  CURRENT_USER_AGENT: "当前用户代理",
  GLOBAL_AGENT: "全局代理",
  SYSTEM_DAEMON: "系统 daemon",
  APPLE_MANAGED: "Apple 管理",
  THIRD_PARTY: "第三方",
  USERHOME_CREATED: "UserHome 自建",
  USERHOME_ADOPTED: "UserHome 已接管",
};

export function ownershipLabel(kind: LaunchdOwnershipKind): string {
  return OWNERSHIP_LABELS[kind];
}

const OWNERSHIP_DESCRIPTIONS: Record<LaunchdOwnershipKind, string> = {
  CURRENT_USER_AGENT:
    "位于当前用户的 ~/Library/LaunchAgents，由当前用户拥有的普通文件。",
  GLOBAL_AGENT: "位于 /Library/LaunchAgents，对所有用户生效的代理。",
  SYSTEM_DAEMON: "运行在系统域，或配置位于 /Library/LaunchDaemons。",
  APPLE_MANAGED: "Apple 提供的任务：label 以 com.apple. 开头，或配置位于 /System/Library。",
  THIRD_PARTY:
    "其余情形：来源、位置、所有者或文件类型不满足认定为当前用户任务的条件。",
  USERHOME_CREATED:
    "label 使用 UserHome 专属前缀，且位于当前用户的 LaunchAgents、由当前用户拥有的普通文件。",
  USERHOME_ADOPTED:
    "当前用户的代理，UserHome 保存了接管记录，并且文件通过了位置、所有者与类型校验。",
};

export function ownershipDescription(kind: LaunchdOwnershipKind): string {
  return OWNERSHIP_DESCRIPTIONS[kind];
}

const READ_ONLY_REASON_TEXTS: Record<LaunchdReadOnlyReason, string> = {
  APPLE_MANAGED:
    "Apple 管理的任务（label 以 com.apple. 开头，或位于 /System/Library）永远只读。",
  SYSTEM_DAEMON_LOCATION: "系统域任务或位于 /Library/LaunchDaemons；本版本不修改系统级任务。",
  GLOBAL_AGENT_LOCATION: "位于 /Library/LaunchAgents，是全局代理；本版本不修改。",
  NOT_ADOPTED: "这是当前用户自己的代理，但尚未被 UserHome 接管；接管之前保持只读。",
  NO_CONFIG_FILE: "没有找到配置文件，无法确认归属。",
  SYMBOLIC_LINK: "配置文件是符号链接，不会被跟随，也不会被修改。",
  LINK_TARGET_OUTSIDE: "符号链接指向预期位置之外，或无法解析目标。",
  OWNER_NOT_CURRENT_USER: "配置文件的所有者不是当前用户（包括 root 所有）。",
  OWNER_UNKNOWN: "无法确定配置文件的所有者。",
  PLIST_NOT_PARSED: "配置文件无法解析，内容不可确认。",
  LABEL_NOT_FROM_PLIST: "任务的 label 不是来自配置文件内容，而是由文件名推断。",
  LABEL_FILENAME_MISMATCH: "配置中的 label 与文件名不一致。",
  DUPLICATE_DEFINITION: "同一 label 有多处定义，无法确定唯一的配置文件。",
  UNAPPROVED_LOCATION: "配置文件不在批准的位置。",
  DISCOVERY_INCOMPLETE:
    "本次发现不完整，无法排除其他同名定义；请刷新后重试。",
};

export function readOnlyReasonText(reason: LaunchdReadOnlyReason): string {
  return READ_ONLY_REASON_TEXTS[reason];
}

const EVIDENCE_TEXTS: Record<LaunchdEvidence, string> = {
  LABEL_APPLE_NAMESPACE: "label 以 com.apple. 开头",
  APPLE_PATH: "配置文件位于 /System/Library 之下",
  LABEL_USERHOME_NAMESPACE: "label 使用 UserHome 专属前缀（仅凭前缀不足以认定）",
  ADOPTION_RECORD: "存在 UserHome 的接管记录",
  DOMAIN_GUI: "属于用户会话域",
  DOMAIN_SYSTEM: "属于系统域",
  IN_USER_LAUNCH_AGENTS: "位于 ~/Library/LaunchAgents",
  IN_GLOBAL_LAUNCH_AGENTS: "位于 /Library/LaunchAgents",
  IN_GLOBAL_LAUNCH_DAEMONS: "位于 /Library/LaunchDaemons",
  OWNER_CURRENT_USER: "文件所有者是当前用户",
  OWNER_OTHER_USER: "文件所有者不是当前用户（包括 root）",
  OWNER_UNKNOWN: "无法确定文件所有者",
  REGULAR_FILE: "是普通文件",
  SYMBOLIC_LINK: "是符号链接（不跟随、不读取）",
  NO_CONFIG_FILE: "没有找到配置文件",
};

export function evidenceText(evidence: LaunchdEvidence): string {
  return EVIDENCE_TEXTS[evidence];
}

export interface OwnershipSummary {
  kind: LaunchdOwnershipKind;
  label: string;
  description: string;
  modifiable: boolean;
  badge: "只读" | "可修改";
  reasons: string[];
  evidence: string[];
  note: string;
}

export function ownershipSummary(service: LaunchdService): OwnershipSummary {
  const { ownership } = service;
  return {
    kind: ownership.kind,
    label: ownershipLabel(ownership.kind),
    description: ownershipDescription(ownership.kind),
    modifiable: ownership.modifiable,
    badge: ownership.modifiable ? "可修改" : "只读",
    reasons: ownership.readOnlyReasons.map(readOnlyReasonText),
    evidence: ownership.evidence.map(evidenceText),
    note: ownership.modifiable
      ? "后端判定该任务属于 UserHome，可以修改；仅提供加载、启动、停止、重启、禁用自启、启用自启与卸载，每个动作先预览再确认，并由后端重新发现、复核归属后才执行；不会删除配置文件。"
      : "只读任务不会被修改：本页面没有修改入口，后端也会在重新判定后拒绝对它的任何修改。",
  };
}

const DOMAIN_LABELS: Record<LaunchdDomain, string> = {
  GUI: "用户会话",
  SYSTEM: "系统",
};

export function domainLabel(domain: LaunchdDomain): string {
  return DOMAIN_LABELS[domain];
}

const SOURCE_LABELS: Record<LaunchdSource, string> = {
  LAUNCHCTL_LIST: "launchctl list（用户会话已加载任务）",
  LAUNCHCTL_PRINT_SYSTEM: "launchctl print system（系统域已加载任务）",
  USER_LAUNCH_AGENTS: "~/Library/LaunchAgents",
  GLOBAL_LAUNCH_AGENTS: "/Library/LaunchAgents",
  GLOBAL_LAUNCH_DAEMONS: "/Library/LaunchDaemons",
  APPLE_LAUNCH_AGENTS: "/System/Library/LaunchAgents",
  APPLE_LAUNCH_DAEMONS: "/System/Library/LaunchDaemons",
};

export function sourceLabel(source: LaunchdSource): string {
  return SOURCE_LABELS[source];
}

const SOURCE_STATUS_LABELS: Record<LaunchdSourceStatus, string> = {
  COMPLETE: "已读取",
  PARTIAL: "部分读取",
  INACCESSIBLE: "无法访问",
  FAILED: "读取失败",
};

export function sourceStatusLabel(status: LaunchdSourceStatus): string {
  return SOURCE_STATUS_LABELS[status];
}

const SOURCE_REASON_TEXTS: Record<LaunchdSourceReason, string> = {
  TIMEOUT: "读取超时。",
  OUTPUT_TOO_LARGE: "输出超过上限，已放弃读取。",
  PROCESS_FAILED: "命令执行失败。",
  PERMISSION_DENIED: "权限不足，无法读取。",
  TOOL_UNAVAILABLE: "所需的系统工具不可用。",
  UNPARSED_OUTPUT: "输出格式无法识别。",
  ENTRY_LIMIT: "条目数量超过上限，结果被截断。",
  DIRECTORY_MISSING: "目录不存在（正常情况，不是失败）。",
  OUTSIDE_HOME: "路径不在用户主目录之内，已拒绝读取。",
  HOME_UNAVAILABLE: "无法确定用户主目录。",
  IO: "读取目录时发生 I/O 错误。",
  FILE_ERRORS: "部分文件读取失败。",
  TIME_BUDGET: "超过时间预算，结果可能不完整。",
};

export function sourceReasonText(reason: LaunchdSourceReason): string {
  return SOURCE_REASON_TEXTS[reason];
}

const PARSE_STATUS_TEXTS: Record<LaunchdParseStatus, string> = {
  PARSED: "已读取内容",
  CONVERT_FAILED: "plist 转换失败，内容未读取",
  TOO_LARGE: "文件过大，内容未读取",
  LINK_NOT_READ: "符号链接，内容未读取",
  UNREADABLE: "无法读取文件",
  TIMED_OUT: "读取超时，内容未读取",
  OUTPUT_TOO_LARGE: "转换输出过大，内容未读取",
  TOOL_UNAVAILABLE: "plutil 不可用，内容未读取",
  NOT_ATTEMPTED: "未尝试读取",
};

export function parseStatusText(status: LaunchdParseStatus): string {
  return PARSE_STATUS_TEXTS[status];
}

const FILE_KIND_TEXTS: Record<LaunchdFileKind, string> = {
  REGULAR: "普通文件",
  LINK: "符号链接",
};

export function fileKindText(kind: LaunchdFileKind): string {
  return FILE_KIND_TEXTS[kind];
}

const LINK_STATE_TEXTS: Record<LaunchdLinkState, string> = {
  INSIDE: "指向预期位置之内",
  OUTSIDE: "指向预期位置之外",
  UNRESOLVED: "无法解析目标",
};

export function linkStateText(state: LaunchdLinkState): string {
  return LINK_STATE_TEXTS[state];
}

const KEEP_ALIVE_TEXTS: Record<LaunchdKeepAliveMode, string> = {
  ALWAYS: "总是保持运行",
  NEVER: "不自动重启",
  CONDITIONAL: "满足条件时保持运行",
};

export function keepAliveText(mode: LaunchdKeepAliveMode): string {
  return KEEP_ALIVE_TEXTS[mode];
}

const ISSUE_TEXTS: Record<LaunchdService["issues"][number], string> = {
  DUPLICATE_LABEL: "多个配置文件使用同一 label",
  DUPLICATE_LOADED_LABEL: "同一 label 被加载了多次",
  LABEL_FILENAME_MISMATCH: "配置中的 label 与文件名不一致",
  MISSING_LABEL: "配置文件没有可用的 label，已改用文件名",
  INVALID_LABEL: "配置中的 label 不合法，已改用文件名",
};

export function issueText(issue: LaunchdService["issues"][number]): string {
  return ISSUE_TEXTS[issue];
}

export function exitText(lastExit: LaunchdLastExit | undefined): string {
  if (lastExit === undefined) return "无记录";
  return lastExit.kind === "SIGNAL"
    ? `信号 ${lastExit.value}`
    : `退出码 ${lastExit.value}`;
}

// ---- status -------------------------------------------------------------------

export const STATUS_CATEGORIES = [
  "RUNNING",
  "LOADED_IDLE",
  "NOT_LOADED",
  "UNKNOWN",
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  RUNNING: "运行中",
  LOADED_IDLE: "已加载，未运行",
  NOT_LOADED: "未加载",
  UNKNOWN: "状态未知",
};

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
export function statusPresentation(service: LaunchdService): StatusPresentation {
  switch (statusCategory(service)) {
    case "RUNNING":
      return {
        label: STATUS_CATEGORY_LABELS.RUNNING,
        tone: "success",
        detail: "存在运行中的进程；进程存在不代表任务运行正常或健康。",
      };
    case "LOADED_IDLE":
      return {
        label: STATUS_CATEGORY_LABELS.LOADED_IDLE,
        tone: "neutral",
        detail:
          "任务已加载，当前没有进程；按需启动或已完成的任务属于正常情况，不是错误。",
      };
    case "NOT_LOADED":
      return {
        label: STATUS_CATEGORY_LABELS.NOT_LOADED,
        tone: "neutral",
        detail: "有配置文件，但 launchd 当前没有加载它；这不是错误。",
      };
    case "UNKNOWN":
      return {
        label: STATUS_CATEGORY_LABELS.UNKNOWN,
        tone: "warning",
        detail:
          service.loadState === "INACCESSIBLE" ||
          service.runState === "INACCESSIBLE"
            ? "没有权限读取该任务的加载或运行状态。"
            : "无法确定该任务是否已加载或正在运行。",
      };
  }
}

const CORRELATION_TEXTS: Record<LaunchdCorrelation, string> = {
  MATCHED: "已加载，并找到同 label 的配置文件。",
  FILE_ONLY: "有配置文件，当前未加载（未看到同 label 的已加载任务）。",
  LOADED_ONLY: "已加载，未在扫描位置找到配置文件。",
  UNMATCHED_FILE:
    "该配置文件无法对应到任务：可能是符号链接（内容不读取）、无法读取，或没有可用的 label。",
};

export function correlationText(service: LaunchdService): string {
  if (
    service.correlation === "LOADED_ONLY" &&
    service.configPresence === "UNKNOWN"
  ) {
    return "已加载；扫描位置未能完整读取，无法确认是否存在配置文件。";
  }
  if (service.correlation === "LOADED_ONLY") {
    return `${CORRELATION_TEXTS.LOADED_ONLY}其他位置（例如应用包内）也可能定义该任务。`;
  }
  return CORRELATION_TEXTS[service.correlation];
}

/** One short line for list rows; the details view has the full explanation. */
export function correlationBrief(service: LaunchdService): string | undefined {
  switch (service.correlation) {
    case "MATCHED":
      return undefined;
    case "FILE_ONLY":
      return "有配置文件，当前未加载";
    case "LOADED_ONLY":
      return service.configPresence === "UNKNOWN"
        ? "已加载，无法确认配置文件"
        : "已加载，未找到配置文件";
    case "UNMATCHED_FILE":
      return "配置文件无法对应到任务";
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
): SourceProblem[] {
  return sourceProblems(discovery.sources);
}

export function sourceProblems(
  reports: readonly LaunchdSourceReport[],
): SourceProblem[] {
  return reports.flatMap((report) => {
    if (report.status === "COMPLETE" && report.failedFiles === 0) return [];
    const parts: string[] = [];
    if (report.reason !== undefined) parts.push(sourceReasonText(report.reason));
    if (report.failedFiles > 0) {
      parts.push(`${report.failedFiles} 个文件未能读取。`);
    }
    return [
      {
        source: report.source,
        status: report.status,
        reason: parts.join("") || "原因未提供。",
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
export function discoveryErrorText(error: AppError): string {
  if (error.code === "CONFLICT") {
    return "本机服务清单正在被另一处读取，尚未完成。请稍候，或点击“重试”再读一次。";
  }
  return error.message;
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
