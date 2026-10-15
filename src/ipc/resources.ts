import type { ConfigDiff, ConfigDiffLine } from "./config";
import {
  createInternalError,
  decodeAppError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";
import { isGrantId } from "./grants";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

// Writes address an authorization id and a path relative to it. The frontend
// never sends an absolute path, so it cannot widen what a write may touch.

export type WriteKind = "REPLACE" | "CREATE";
export type RecoveryPointKind = "BACKUP" | "NONE_CREATED" | "NONE_UNAVAILABLE";
export type FileState =
  | "WRITTEN"
  | "UNCHANGED"
  | "RESTORED"
  | "RESTORE_FAILED"
  | "CREATED_REMOVED"
  | "CREATED_REMOVE_FAILED"
  | "UNKNOWN";
export type WriteStatus = "SUCCEEDED" | "FAILED";
export type StepState =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "BLOCKED";

export interface ResourceWriteRequest {
  readonly grantId: string;
  /** Path below a directory authorization; omit for a file authorization. */
  readonly relativePath?: string;
  /** SHA-256 of the content that was read; omit to create a new file. */
  readonly expectedHash?: string;
  readonly content: string;
  /** Redacts the diff in the preview. */
  readonly sensitive?: boolean;
}

export interface ResourceWritePreview extends OperationPreview {
  kind: WriteKind;
  recoveryPoint: RecoveryPointKind;
  target: string;
  currentHash?: string;
  proposedHash: string;
  diff: ConfigDiff;
}

export interface ResourceWriteBatchPreview {
  batchId: string;
  atomic: false;
  note: string;
  steps: ResourceWritePreview[];
}

export interface WriteOutcome {
  kind: WriteKind;
  status: WriteStatus;
  fileState: FileState;
  recoveryPoint: RecoveryPointKind;
  backupId?: string;
  summary: string;
  error?: AppError;
}

/**
 * A refused confirmation rejects with an `AppError` and changed nothing. A
 * resolved value means the transaction ran: check `outcome.status` and
 * `outcome.fileState` for what the target really contains.
 */
export interface ResourceWriteExecution extends OperationDetails {
  outcome: WriteOutcome;
}

export interface ResourceWriteStepStatus {
  index: number;
  operationId: string;
  target: string;
  kind: WriteKind;
  state: StepState;
  outcome?: WriteOutcome;
  error?: AppError;
}

export interface ResourceWriteBatchStatus {
  batchId: string;
  atomic: false;
  note: string;
  completed: number;
  total: number;
  steps: ResourceWriteStepStatus[];
}

const WRITE_KINDS: readonly string[] = ["REPLACE", "CREATE"];
const RECOVERY_POINTS: readonly string[] = [
  "BACKUP",
  "NONE_CREATED",
  "NONE_UNAVAILABLE",
];
const FILE_STATES: readonly string[] = [
  "WRITTEN",
  "UNCHANGED",
  "RESTORED",
  "RESTORE_FAILED",
  "CREATED_REMOVED",
  "CREATED_REMOVE_FAILED",
  "UNKNOWN",
];
const WRITE_STATUSES: readonly string[] = ["SUCCEEDED", "FAILED"];
const STEP_STATES: readonly string[] = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REJECTED",
  "BLOCKED",
];
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BATCH_STEPS = 16;
const MAX_TEXT_LENGTH = 4096;

function invalidInput(message: string): AppError {
  return { code: "INVALID_INPUT", message, retryable: false };
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly string[],
): value is T {
  return typeof value === "string" && allowed.includes(value);
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !hasControlCharacters(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function decodeText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT_LENGTH
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeDiff(value: unknown): ConfigDiff {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    typeof value.redacted !== "boolean" ||
    typeof value.truncated !== "boolean"
  ) {
    throw createInternalError();
  }
  const lines = value.lines.map((line): ConfigDiffLine => {
    if (
      !isRecord(line) ||
      (line.kind !== "REMOVED" && line.kind !== "ADDED") ||
      typeof line.text !== "string"
    ) {
      throw createInternalError();
    }
    return { kind: line.kind, text: line.text };
  });
  return { lines, redacted: value.redacted, truncated: value.truncated };
}

function decodeKind(value: unknown): WriteKind {
  if (!isOneOf<WriteKind>(value, WRITE_KINDS)) throw createInternalError();
  return value;
}

function decodeRecoveryPoint(value: unknown): RecoveryPointKind {
  if (!isOneOf<RecoveryPointKind>(value, RECOVERY_POINTS)) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalHash(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw createInternalError();
  }
  return value;
}

function decodeNotAtomic(value: Record<string, unknown>): string {
  // The backend never claims atomicity; a response that does is not trusted.
  if (value.atomic !== false) throw createInternalError();
  return decodeText(value.note);
}

export function decodeResourceWritePreview(
  value: unknown,
): ResourceWritePreview {
  const operation = decodeOperationPreview(value);
  if (
    !isRecord(value) ||
    typeof value.proposedHash !== "string" ||
    !HASH_PATTERN.test(value.proposedHash)
  ) {
    throw createInternalError();
  }
  const kind = decodeKind(value.kind);
  const recoveryPoint = decodeRecoveryPoint(value.recoveryPoint);
  const currentHash = decodeOptionalHash(value.currentHash);
  // A new file has nothing to back up, and a replacement always has a hash.
  if (
    (kind === "CREATE") !== (recoveryPoint === "NONE_CREATED") ||
    (kind === "CREATE") !== (currentHash === undefined)
  ) {
    throw createInternalError();
  }
  return {
    ...operation,
    kind,
    recoveryPoint,
    target: decodeText(value.target),
    ...(currentHash === undefined ? {} : { currentHash }),
    proposedHash: value.proposedHash,
    diff: decodeDiff(value.diff),
  };
}

export function decodeResourceWriteBatchPreview(
  value: unknown,
): ResourceWriteBatchPreview {
  if (
    !isRecord(value) ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > MAX_BATCH_STEPS
  ) {
    throw createInternalError();
  }
  return {
    batchId: decodeText(value.batchId),
    atomic: false,
    note: decodeNotAtomic(value),
    steps: value.steps.map(decodeResourceWritePreview),
  };
}

export function decodeWriteOutcome(value: unknown): WriteOutcome {
  if (
    !isRecord(value) ||
    !isOneOf<WriteStatus>(value.status, WRITE_STATUSES) ||
    !isOneOf<FileState>(value.fileState, FILE_STATES) ||
    typeof value.summary !== "string" ||
    value.summary.length === 0
  ) {
    throw createInternalError();
  }
  const kind = decodeKind(value.kind);
  const recoveryPoint = decodeRecoveryPoint(value.recoveryPoint);
  const backupId = value.backupId;
  if (backupId !== undefined && typeof backupId !== "string") {
    throw createInternalError();
  }
  // A creation never has a recovery point to point at.
  if (
    (kind === "CREATE" && (recoveryPoint !== "NONE_CREATED" || backupId !== undefined)) ||
    (kind === "REPLACE" && recoveryPoint === "NONE_CREATED") ||
    (recoveryPoint === "BACKUP") !== (backupId !== undefined)
  ) {
    throw createInternalError();
  }
  if (value.status === "SUCCEEDED" && value.fileState !== "WRITTEN") {
    throw createInternalError();
  }
  return {
    kind,
    status: value.status,
    fileState: value.fileState,
    recoveryPoint,
    ...(backupId === undefined ? {} : { backupId }),
    summary: value.summary,
    ...(value.error === undefined ? {} : { error: decodeAppError(value.error) }),
  };
}

export function decodeResourceWriteExecution(
  value: unknown,
): ResourceWriteExecution {
  const details = decodeOperationDetails(value);
  if (!isRecord(value)) throw createInternalError();
  return { ...details, outcome: decodeWriteOutcome(value.outcome) };
}

function decodeStepStatus(value: unknown, position: number): ResourceWriteStepStatus {
  if (
    !isRecord(value) ||
    value.index !== position ||
    !isOneOf<StepState>(value.state, STEP_STATES)
  ) {
    throw createInternalError();
  }
  return {
    index: position,
    operationId: decodeText(value.operationId),
    target: decodeText(value.target),
    kind: decodeKind(value.kind),
    state: value.state,
    ...(value.outcome === undefined
      ? {}
      : { outcome: decodeWriteOutcome(value.outcome) }),
    ...(value.error === undefined ? {} : { error: decodeAppError(value.error) }),
  };
}

export function decodeResourceWriteBatchStatus(
  value: unknown,
): ResourceWriteBatchStatus {
  if (
    !isRecord(value) ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > MAX_BATCH_STEPS ||
    typeof value.completed !== "number" ||
    typeof value.total !== "number" ||
    value.total !== value.steps.length
  ) {
    throw createInternalError();
  }
  const steps = value.steps.map(decodeStepStatus);
  // The completed count must be backed by steps that really succeeded.
  if (steps.filter((step) => step.state === "SUCCEEDED").length !== value.completed) {
    throw createInternalError();
  }
  return {
    batchId: decodeText(value.batchId),
    atomic: false,
    note: decodeNotAtomic(value),
    completed: value.completed,
    total: value.total,
    steps,
  };
}

function encodeWrite(write: ResourceWriteRequest): Record<string, unknown> {
  if (!isGrantId(write.grantId)) {
    throw invalidInput("Authorization id is invalid.");
  }
  if (write.relativePath !== undefined && !isSafeRelativePath(write.relativePath)) {
    throw invalidInput("The relative path is not allowed.");
  }
  if (write.expectedHash !== undefined && !HASH_PATTERN.test(write.expectedHash)) {
    throw invalidInput("The content hash is invalid.");
  }
  if (typeof write.content !== "string") {
    throw invalidInput("The content must be text.");
  }
  return {
    grantId: write.grantId,
    ...(write.relativePath === undefined ? {} : { relativePath: write.relativePath }),
    ...(write.expectedHash === undefined ? {} : { expectedHash: write.expectedHash }),
    content: write.content,
    ...(write.sensitive === true ? { sensitive: true } : {}),
  };
}

export function previewResourceWrites(
  writes: readonly ResourceWriteRequest[],
): Promise<ResourceWriteBatchPreview> {
  try {
    if (writes.length === 0 || writes.length > MAX_BATCH_STEPS) {
      throw invalidInput("A write batch must contain between 1 and 16 resources.");
    }
    const encoded = writes.map(encodeWrite);
    return invokeCommand("preview_resource_writes", decodeResourceWriteBatchPreview, {
      input: { writes: encoded },
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

export function executeResourceWrite(input: {
  operationId: string;
  grantId: string;
  relativePath?: string;
}): Promise<ResourceWriteExecution> {
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    return Promise.reject(invalidInput("Operation id is invalid."));
  }
  if (!isGrantId(input.grantId)) {
    return Promise.reject(invalidInput("Authorization id is invalid."));
  }
  if (input.relativePath !== undefined && !isSafeRelativePath(input.relativePath)) {
    return Promise.reject(invalidInput("The relative path is not allowed."));
  }
  return invokeCommand("execute_resource_write", decodeResourceWriteExecution, {
    input: {
      operationId: input.operationId,
      grantId: input.grantId,
      ...(input.relativePath === undefined ? {} : { relativePath: input.relativePath }),
    },
  });
}

export function getResourceWriteBatch(
  batchId: string,
): Promise<ResourceWriteBatchStatus> {
  return invokeCommand("get_resource_write_batch", decodeResourceWriteBatchStatus, {
    batchId,
  });
}
