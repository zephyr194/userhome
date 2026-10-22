import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";

export type GrantPurpose =
  | "CONFIG_DIRECTORY"
  | "CONFIG_FILE"
  | "EXECUTABLE"
  | "SHELL_STARTUP_FILE"
  | "LAUNCH_AGENT_FILE"
  | "TLS_MATERIAL_FILE"
  | "CADDY_WORK_DIR";
export type GrantKind = "DIRECTORY" | "FILE";

export interface GrantSummary {
  readonly id: string;
  readonly purpose: GrantPurpose;
  readonly kind: GrantKind;
  readonly displayPath: string;
  readonly createdAtEpochMs: number;
}

const GRANT_PURPOSES: readonly string[] = [
  "CONFIG_DIRECTORY",
  "CONFIG_FILE",
  "EXECUTABLE",
  "SHELL_STARTUP_FILE",
  "LAUNCH_AGENT_FILE",
  "TLS_MATERIAL_FILE",
  "CADDY_WORK_DIR",
];
const DIRECTORY_PURPOSES: readonly string[] = ["CONFIG_DIRECTORY", "CADDY_WORK_DIR"];
const GRANT_KINDS: readonly string[] = ["DIRECTORY", "FILE"];
const GRANT_PURPOSE_LABELS: Record<GrantPurpose, string> = {
  CONFIG_DIRECTORY: "配置目录",
  CONFIG_FILE: "配置文件",
  EXECUTABLE: "可执行文件",
  SHELL_STARTUP_FILE: "shell 启动文件",
  LAUNCH_AGENT_FILE: "launchd 自建任务配置",
  TLS_MATERIAL_FILE: "TLS 证书或私钥文件",
  CADDY_WORK_DIR: "Caddy 工作目录",
};
const GRANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DISPLAY_PATH_LENGTH = 1024;
const MAX_GRANTS = 256;

export function grantPurposeLabel(purpose: GrantPurpose): string {
  return GRANT_PURPOSE_LABELS[purpose];
}

export function isGrantId(value: unknown): value is string {
  return typeof value === "string" && GRANT_ID_PATTERN.test(value);
}

export function decodeGrantSummary(value: unknown): GrantSummary {
  if (
    !isRecord(value) ||
    !isGrantId(value.id) ||
    typeof value.purpose !== "string" ||
    !GRANT_PURPOSES.includes(value.purpose) ||
    typeof value.kind !== "string" ||
    !GRANT_KINDS.includes(value.kind) ||
    typeof value.displayPath !== "string" ||
    value.displayPath.length === 0 ||
    value.displayPath.length > MAX_DISPLAY_PATH_LENGTH ||
    hasControlCharacters(value.displayPath) ||
    typeof value.createdAtEpochMs !== "number" ||
    !Number.isSafeInteger(value.createdAtEpochMs) ||
    value.createdAtEpochMs < 0
  ) {
    throw createInternalError();
  }
  const purpose = value.purpose as GrantPurpose;
  const kind = value.kind as GrantKind;
  if (DIRECTORY_PURPOSES.includes(purpose) !== (kind === "DIRECTORY")) {
    throw createInternalError();
  }
  return {
    id: value.id,
    purpose,
    kind,
    displayPath: value.displayPath,
    createdAtEpochMs: value.createdAtEpochMs,
  };
}

export function decodeGrantList(value: unknown): GrantSummary[] {
  if (!Array.isArray(value) || value.length > MAX_GRANTS) {
    throw createInternalError();
  }
  return value.map(decodeGrantSummary);
}

function decodeRevoked(value: unknown): void {
  if (value !== null && value !== undefined) {
    throw createInternalError();
  }
}

export function listGrants(): Promise<GrantSummary[]> {
  return invokeCommand("list_grants", decodeGrantList);
}

export function revokeGrant(grantId: string): Promise<void> {
  if (!isGrantId(grantId)) {
    return Promise.reject({
      code: "INVALID_INPUT",
      message: "Authorization id is invalid.",
      retryable: false,
    });
  }
  return invokeCommand("revoke_grant", decodeRevoked, { input: { grantId } });
}

/**
 * Purposes a file dialog can authorize. A shell startup file grant is made
 * only by the startup file editor in the backend, and a LaunchAgent file grant
 * only by the launchd task creator; never by a selection.
 */
export type FileGrantPurpose = Exclude<
  GrantPurpose,
  | "CONFIG_DIRECTORY"
  | "SHELL_STARTUP_FILE"
  | "LAUNCH_AGENT_FILE"
  | "TLS_MATERIAL_FILE"
  | "CADDY_WORK_DIR"
>;

export type SelectGrantResult =
  | { readonly status: "SELECTED"; readonly grant: GrantSummary }
  | { readonly status: "CANCELLED" };

const FILE_GRANT_PURPOSES: readonly string[] = ["CONFIG_FILE", "EXECUTABLE"];

export function decodeSelectGrantResult(
  value: unknown,
  purpose: GrantPurpose,
): SelectGrantResult {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  if (value.status === "CANCELLED") {
    if (Object.keys(value).length !== 1) {
      throw createInternalError();
    }
    return { status: "CANCELLED" };
  }
  if (value.status !== "SELECTED") {
    throw createInternalError();
  }
  const grant = decodeGrantSummary(value.grant);
  if (grant.purpose !== purpose) {
    throw createInternalError();
  }
  return { status: "SELECTED", grant };
}

function selectGrant(
  command: string,
  purpose: GrantPurpose,
): Promise<SelectGrantResult> {
  return invokeCommand(
    command,
    (value) => decodeSelectGrantResult(value, purpose),
    { input: { purpose } },
  );
}

// The backend opens the native panel and creates the grant; the frontend
// only names a purpose and never sends or receives an absolute path.
export function selectDirectoryGrant(): Promise<SelectGrantResult> {
  return selectGrant("select_directory_grant", "CONFIG_DIRECTORY");
}

export function selectFileGrant(
  purpose: FileGrantPurpose,
): Promise<SelectGrantResult> {
  if (!FILE_GRANT_PURPOSES.includes(purpose)) {
    return Promise.reject({
      code: "INVALID_INPUT",
      message: "Authorization purpose is invalid.",
      retryable: false,
    });
  }
  return selectGrant("select_file_grant", purpose);
}

// Used only by the TLS option of a Caddy site; the result's display path is not
// shown, because the TLS panel shows file names from the backend status instead.
export function selectTlsMaterialGrant(): Promise<SelectGrantResult> {
  return selectGrant("select_file_grant", "TLS_MATERIAL_FILE");
}

export function selectSaveLocationGrant(): Promise<SelectGrantResult> {
  return selectGrant("select_save_location_grant", "CONFIG_FILE");
}

export type GrantStoreProblem =
  | "CORRUPT"
  | "NEWER_VERSION"
  | "NOT_REGULAR_FILE"
  | "IO";
export type ResettableGrantStoreProblem = Extract<
  GrantStoreProblem,
  "CORRUPT" | "NEWER_VERSION"
>;

export type GrantStoreStatus =
  | { readonly status: "AVAILABLE" }
  | { readonly status: "UNAVAILABLE"; readonly reason: GrantStoreProblem };

export interface GrantStoreReset {
  readonly quarantineFileName: string;
  readonly previousReason: ResettableGrantStoreProblem;
}

const GRANT_STORE_PROBLEMS: readonly string[] = [
  "CORRUPT",
  "NEWER_VERSION",
  "NOT_REGULAR_FILE",
  "IO",
];
const RESETTABLE_PROBLEMS: readonly string[] = ["CORRUPT", "NEWER_VERSION"];
// A bare file name `grants.json.corrupt-<UTC stamp>[-<n>]`; never a path.
const QUARANTINE_FILE_NAME_PATTERN = /^grants\.json\.corrupt-[0-9A-Za-z]+(-[0-9]+)?$/;

export function decodeGrantStoreStatus(value: unknown): GrantStoreStatus {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  const keys = Object.keys(value);
  if (value.status === "AVAILABLE" && keys.length === 1) {
    return { status: "AVAILABLE" };
  }
  if (
    value.status === "UNAVAILABLE" &&
    keys.length === 2 &&
    typeof value.reason === "string" &&
    GRANT_STORE_PROBLEMS.includes(value.reason)
  ) {
    return {
      status: "UNAVAILABLE",
      reason: value.reason as GrantStoreProblem,
    };
  }
  throw createInternalError();
}

export function decodeGrantStoreReset(value: unknown): GrantStoreReset {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.quarantineFileName !== "string" ||
    !QUARANTINE_FILE_NAME_PATTERN.test(value.quarantineFileName) ||
    typeof value.previousReason !== "string" ||
    !RESETTABLE_PROBLEMS.includes(value.previousReason)
  ) {
    throw createInternalError();
  }
  return {
    quarantineFileName: value.quarantineFileName,
    previousReason: value.previousReason as ResettableGrantStoreProblem,
  };
}

export function getGrantStoreStatus(): Promise<GrantStoreStatus> {
  return invokeCommand("get_grant_store_status", decodeGrantStoreStatus);
}

// The reset takes no path: the backend always isolates its own grants.json,
// and only after the user confirmed in the UI.
export function resetGrantStore(): Promise<GrantStoreReset> {
  return invokeCommand("reset_grant_store", decodeGrantStoreReset, {
    input: {},
  });
}
