import {
  createInternalError,
  decodeAppError,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";
import {
  decodeResourceWriteExecution,
  decodeResourceWritePreview,
  type ResourceWriteExecution,
  type ResourceWritePreview,
} from "./resources";
import {
  CREATE_SERVICE_LIMITS,
  hasForbiddenTextCharacters,
  isValidLaunchdLabel,
} from "./services";

// Adopting an existing user job and editing an adopted one. Requests carry a
// domain and a label (plus, for an edit, the fields to change); the backend
// rediscovers the job and judges it again on every step. Responses are decoded
// strictly: a malformed or self-contradicting payload fails closed.

const MAX_TEXT_BYTES = 1024;
const MAX_ARGUMENTS = CREATE_SERVICE_LIMITS.arguments;
const MAX_ENVIRONMENT_ENTRIES = CREATE_SERVICE_LIMITS.environmentEntries;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const EDIT_CHANGE_KEYS = [
  "ProgramArguments",
  "WorkingDirectory",
  "StandardOutPath",
  "StandardErrorPath",
  "EnvironmentVariables",
  "RunAtLoad",
  "KeepAlive",
] as const;
export type EditChangeKey = (typeof EDIT_CHANGE_KEYS)[number];

/** The only domain the current user can act on from here. */
export type AdoptDomain = "GUI";

export interface AdoptServiceRequest {
  domain: AdoptDomain;
  label: string;
}

export interface AdoptPreview extends OperationPreview {
  label: string;
  domain: AdoptDomain;
  /** Display text: where the job's plist is looked for. */
  source: string;
  filePath: string;
  backup: string;
  /** Always empty: adoption never changes the plist. */
  changedFields: [];
  externalManagerNote: string;
  effectNote: string;
}

export interface AdoptExecution extends OperationDetails {
  label: string;
  domain: AdoptDomain;
  filePath: string;
  backupId: string;
  plistChanged: false;
  effectNote: string;
}

export interface ReleaseOutcome {
  label: string;
  domain: AdoptDomain;
  released: boolean;
  plistChanged: false;
}

/**
 * A structured edit. Absent fields are unchanged. An empty `workingDirectory`,
 * `stdoutPath` or `stderrPath` removes that key. `environmentSet` values travel
 * once, here, and never come back.
 */
export interface EditServiceRequest {
  domain: AdoptDomain;
  label: string;
  executable?: string;
  arguments?: string[];
  workingDirectory?: string;
  environmentSet: Record<string, string>;
  environmentRemove: string[];
  stdoutPath?: string;
  stderrPath?: string;
  runAtLoad?: boolean;
  keepAlive?: boolean;
}

export interface EditPreview extends ResourceWritePreview {
  label: string;
  domain: AdoptDomain;
  filePath: string;
  changes: EditChangeKey[];
  executable?: string;
  /** Sensitive values are masked by the backend. */
  arguments?: string[];
  /** Names only. */
  environmentSet: string[];
  environmentRemoved: string[];
  backup: string;
  reloadNote: string;
}

export interface EditExecution extends ResourceWriteExecution {
  label: string;
  domain: AdoptDomain;
  filePath: string;
  grantReleaseError?: AppError;
  reloadRequired: true;
  reloadNote: string;
}

function invalidRequest(): AppError {
  // Deliberately generic: an edit request may hold secrets.
  return {
    code: "INVALID_INPUT",
    message: "The service request is not valid.",
    retryable: false,
  };
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function boundedText(value: unknown, maxBytes = MAX_TEXT_BYTES): string {
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

function displayPath(value: unknown): string {
  const path = boundedText(value);
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    throw createInternalError();
  }
  return path;
}

function requireGuiDomain(value: unknown): AdoptDomain {
  if (value !== "GUI") throw createInternalError();
  return "GUI";
}

function requireLabel(value: unknown): string {
  if (!isValidLaunchdLabel(value)) throw createInternalError();
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInternalError();
  return value;
}

function listOf<T>(value: unknown, limit: number, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw createInternalError();
  }
  return value.map(decode);
}

function environmentKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > CREATE_SERVICE_LIMITS.environmentKeyBytes ||
    !ENV_KEY_PATTERN.test(value)
  ) {
    throw createInternalError();
  }
  return value;
}

function uniqueEnvironmentKeys(value: unknown): string[] {
  const keys = listOf(value, MAX_ENVIRONMENT_ENTRIES, environmentKey);
  if (new Set(keys).size !== keys.length) throw createInternalError();
  return keys;
}

function editChangeKey(value: unknown): EditChangeKey {
  if (!(EDIT_CHANGE_KEYS as readonly unknown[]).includes(value)) {
    throw createInternalError();
  }
  return value as EditChangeKey;
}

function optionalValue<T>(
  value: unknown,
  decode: (item: unknown) => T,
): T | undefined {
  return value === undefined || value === null ? undefined : decode(value);
}

export function decodeAdoptPreview(value: unknown): AdoptPreview {
  const operation = decodeOperationPreview(value);
  if (!isRecord(value)) throw createInternalError();
  // Adoption never changes the plist; a preview that lists changed fields is not trusted.
  if (!Array.isArray(value.changedFields) || value.changedFields.length !== 0) {
    throw createInternalError();
  }
  return {
    ...operation,
    label: requireLabel(value.label),
    domain: requireGuiDomain(value.domain),
    source: boundedText(value.source),
    filePath: displayPath(value.filePath),
    backup: boundedText(value.backup),
    changedFields: [],
    externalManagerNote: boundedText(value.externalManagerNote),
    effectNote: boundedText(value.effectNote),
  };
}

export function decodeAdoptExecution(value: unknown): AdoptExecution {
  const operation = decodeOperationDetails(value);
  if (!isRecord(value)) throw createInternalError();
  // A result is a success only when the operation says so and the plist is untouched.
  if (
    operation.status !== "SUCCEEDED" ||
    value.plistChanged !== false
  ) {
    throw createInternalError();
  }
  return {
    ...operation,
    label: requireLabel(value.label),
    domain: requireGuiDomain(value.domain),
    filePath: displayPath(value.filePath),
    backupId: boundedText(value.backupId, 256),
    plistChanged: false,
    effectNote: boundedText(value.effectNote),
  };
}

export function decodeReleaseOutcome(value: unknown): ReleaseOutcome {
  if (!isRecord(value) || value.plistChanged !== false) {
    throw createInternalError();
  }
  return {
    label: requireLabel(value.label),
    domain: requireGuiDomain(value.domain),
    released: requireBoolean(value.released),
    plistChanged: false,
  };
}

export function decodeEditPreview(value: unknown): EditPreview {
  const write = decodeResourceWritePreview(value);
  if (!isRecord(value) || write.kind !== "REPLACE") {
    throw createInternalError();
  }
  const changes = listOf(value.changes, EDIT_CHANGE_KEYS.length, editChangeKey);
  if (changes.length === 0 || new Set(changes).size !== changes.length) {
    throw createInternalError();
  }
  const executable = optionalValue(value.executable, boundedText);
  const argumentList = optionalValue(value.arguments, (item) =>
    listOf(item, MAX_ARGUMENTS, (argument) => {
      // An empty argument is a real argument; only the bounds apply.
      if (
        typeof argument !== "string" ||
        new TextEncoder().encode(argument).length >
          CREATE_SERVICE_LIMITS.argumentBytes ||
        hasForbiddenTextCharacters(argument)
      ) {
        throw createInternalError();
      }
      return argument;
    }),
  );
  const environmentSet = uniqueEnvironmentKeys(value.environmentSet);
  const environmentRemoved = uniqueEnvironmentKeys(value.environmentRemoved);
  const programFields = [executable, argumentList].filter(
    (field) => field !== undefined,
  ).length;
  const changesProgram = changes.includes("ProgramArguments");
  const changesEnvironment = changes.includes("EnvironmentVariables");
  // The program and environment fields appear exactly when the change they describe is listed.
  if (
    programFields !== (changesProgram ? 2 : 0) ||
    changesEnvironment !== environmentSet.length + environmentRemoved.length > 0
  ) {
    throw createInternalError();
  }
  return {
    ...write,
    label: requireLabel(value.label),
    domain: requireGuiDomain(value.domain),
    filePath: displayPath(value.filePath),
    changes,
    ...(executable === undefined ? {} : { executable }),
    ...(argumentList === undefined ? {} : { arguments: argumentList }),
    environmentSet,
    environmentRemoved,
    backup: boundedText(value.backup),
    reloadNote: boundedText(value.reloadNote),
  };
}

export function decodeEditExecution(value: unknown): EditExecution {
  const execution = decodeResourceWriteExecution(value);
  if (!isRecord(value) || value.reloadRequired !== true) {
    throw createInternalError();
  }
  const written = execution.outcome.status === "SUCCEEDED";
  // The operation and the file outcome must agree; a success is never shown for a failed write.
  if (written !== (execution.status === "SUCCEEDED")) {
    throw createInternalError();
  }
  const grantReleaseError = optionalValue(value.grantReleaseError, decodeAppError);
  return {
    ...execution,
    label: requireLabel(value.label),
    domain: requireGuiDomain(value.domain),
    filePath: displayPath(value.filePath),
    ...(grantReleaseError === undefined ? {} : { grantReleaseError }),
    reloadRequired: true,
    reloadNote: boundedText(value.reloadNote),
  };
}

function adoptRequestPayload(request: AdoptServiceRequest): AdoptServiceRequest {
  if (
    !isRecord(request) ||
    request.domain !== "GUI" ||
    !isValidLaunchdLabel(request.label)
  ) {
    throw invalidRequest();
  }
  return { domain: "GUI", label: request.label };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isText(value)) throw invalidRequest();
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isText)) throw invalidRequest();
  return [...value];
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalidRequest();
  return value;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value) || !Object.values(value).every(isText)) {
    throw invalidRequest();
  }
  return { ...(value as Record<string, string>) };
}

/**
 * Exactly the named fields, with the optional ones present only when set; any
 * other key a caller adds is dropped.
 */
function editRequestPayload(request: EditServiceRequest): EditServiceRequest {
  if (!isRecord(request) || request.domain !== "GUI" || !isValidLaunchdLabel(request.label)) {
    throw invalidRequest();
  }
  const executable = optionalString(request.executable);
  const argumentList = optionalStringArray(request.arguments);
  const workingDirectory = optionalString(request.workingDirectory);
  const stdoutPath = optionalString(request.stdoutPath);
  const stderrPath = optionalString(request.stderrPath);
  const runAtLoad = optionalBoolean(request.runAtLoad);
  const keepAlive = optionalBoolean(request.keepAlive);
  const environmentSet = stringRecord(request.environmentSet);
  if (
    !Array.isArray(request.environmentRemove) ||
    !request.environmentRemove.every(isText)
  ) {
    throw invalidRequest();
  }
  return {
    domain: "GUI",
    label: request.label,
    ...(executable === undefined ? {} : { executable }),
    ...(argumentList === undefined ? {} : { arguments: argumentList }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    environmentSet,
    environmentRemove: [...request.environmentRemove],
    ...(stdoutPath === undefined ? {} : { stdoutPath }),
    ...(stderrPath === undefined ? {} : { stderrPath }),
    ...(runAtLoad === undefined ? {} : { runAtLoad }),
    ...(keepAlive === undefined ? {} : { keepAlive }),
  };
}

function operationIdPayload(operationId: unknown): string {
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw invalidRequest();
  }
  return operationId;
}

function rejectWith<T>(error: unknown): Promise<T> {
  return Promise.reject(decodeAppError(error));
}

/** Previews adopting one job; writes nothing. */
export function previewAdoptLaunchdService(
  request: AdoptServiceRequest,
): Promise<AdoptPreview> {
  let input: AdoptServiceRequest;
  try {
    input = adoptRequestPayload(request);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("preview_adopt_launchd_service", decodeAdoptPreview, {
    input,
  });
}

/** Confirms an adoption preview by its operation id only. */
export function executeAdoptLaunchdService(
  operationId: string,
): Promise<AdoptExecution> {
  let id: string;
  try {
    id = operationIdPayload(operationId);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("execute_adopt_launchd_service", decodeAdoptExecution, {
    operationId: id,
  });
}

/** Removes UserHome's record of an adopted job; the plist and the job stay as they are. */
export function releaseAdoption(
  request: AdoptServiceRequest,
): Promise<ReleaseOutcome> {
  let input: AdoptServiceRequest;
  try {
    input = adoptRequestPayload(request);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("release_adoption", decodeReleaseOutcome, { input });
}

/** Previews a structured edit of an adopted job; writes nothing. */
export function previewEditLaunchdService(
  request: EditServiceRequest,
): Promise<EditPreview> {
  let input: EditServiceRequest;
  try {
    input = editRequestPayload(request);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("preview_edit_launchd_service", decodeEditPreview, {
    input,
  });
}

/** Confirms an edit preview by its operation id only. */
export function executeEditLaunchdService(
  operationId: string,
): Promise<EditExecution> {
  let id: string;
  try {
    id = operationIdPayload(operationId);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("execute_edit_launchd_service", decodeEditExecution, {
    operationId: id,
  });
}

function decodeNoValue(value: unknown): void {
  if (value !== undefined && value !== null) throw createInternalError();
}

/** Gives up an edit preview; its one-file grant is revoked. Safe to repeat. */
export function discardEditLaunchdService(operationId: string): Promise<void> {
  let id: string;
  try {
    id = operationIdPayload(operationId);
  } catch (error) {
    return rejectWith(error);
  }
  return invokeCommand("discard_edit_launchd_service", decodeNoValue, {
    operationId: id,
  });
}
