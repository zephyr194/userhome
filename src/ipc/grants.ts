import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";

export type GrantPurpose = "CONFIG_DIRECTORY" | "CONFIG_FILE" | "EXECUTABLE";
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
];
const GRANT_KINDS: readonly string[] = ["DIRECTORY", "FILE"];
const GRANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DISPLAY_PATH_LENGTH = 1024;
const MAX_GRANTS = 256;

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
  if ((purpose === "CONFIG_DIRECTORY") !== (kind === "DIRECTORY")) {
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

export type FileGrantPurpose = Exclude<GrantPurpose, "CONFIG_DIRECTORY">;

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

export function selectSaveLocationGrant(): Promise<SelectGrantResult> {
  return selectGrant("select_save_location_grant", "CONFIG_FILE");
}
