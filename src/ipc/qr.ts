import {
  createInternalError,
  decodeAppError,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";

export type QrErrorCorrection = "L" | "M" | "Q" | "H";
export type QrPixelSize = 256 | 512 | 1024;

export interface QrPreview {
  pngBase64: string;
  sha256: string;
  imagePx: number;
  modulePx: number;
  moduleCount: number;
}

export type QrWriteKind = "REPLACE" | "CREATE";
export type QrRecoveryPoint = "BACKUP" | "NONE_CREATED" | "NONE_UNAVAILABLE";

export interface PreparedQrExport {
  grantId: string;
  operationId: string;
  kind: QrWriteKind;
  recoveryPoint: QrRecoveryPoint;
  target: string;
  currentHash?: string;
  proposedHash: string;
}

export type PrepareQrExportOutcome =
  | { status: "CANCELLED" }
  | ({ status: "PREVIEWED" } & PreparedQrExport);

export type QrFileState =
  | "WRITTEN"
  | "UNCHANGED"
  | "RESTORED"
  | "RESTORE_FAILED"
  | "CREATED_REMOVED"
  | "CREATED_REMOVE_FAILED"
  | "UNKNOWN";

export interface QrExportOutcome {
  kind: QrWriteKind;
  status: "SUCCEEDED" | "FAILED";
  fileState: QrFileState;
  recoveryPoint: QrRecoveryPoint;
  backupId?: string;
  summary: string;
  error?: AppError;
}

export interface PreviewQrInput {
  text: string;
  level: QrErrorCorrection;
  size: QrPixelSize;
}

export interface ExportQrInput extends PreviewQrInput {
  expectedSha256: string;
}

export interface ConfirmQrExportInput {
  operationId: string;
  grantId: string;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PNG_BASE64_PREFIX = "iVBORw0KGgo";
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

function decodePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw createInternalError();
  }
  return value;
}

function decodeString(value: unknown): string {
  if (typeof value !== "string") {
    throw createInternalError();
  }
  return value;
}

function decodeHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw createInternalError();
  }
  return value;
}

function decodeEnum<T extends string>(
  value: unknown,
  allowed: readonly string[],
): T {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

export function decodeQrPreview(value: unknown): QrPreview {
  if (
    !isRecord(value) ||
    typeof value.pngBase64 !== "string" ||
    !BASE64_PATTERN.test(value.pngBase64) ||
    !value.pngBase64.startsWith(PNG_BASE64_PREFIX)
  ) {
    throw createInternalError();
  }
  return {
    pngBase64: value.pngBase64,
    sha256: decodeHash(value.sha256),
    imagePx: decodePositiveInteger(value.imagePx),
    modulePx: decodePositiveInteger(value.modulePx),
    moduleCount: decodePositiveInteger(value.moduleCount),
  };
}

export function decodePrepareQrExportOutcome(
  value: unknown,
): PrepareQrExportOutcome {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  if (value.status === "CANCELLED") {
    return { status: "CANCELLED" };
  }
  if (value.status !== "PREVIEWED") {
    throw createInternalError();
  }
  const preview: PreparedQrExport = {
    grantId: decodeString(value.grantId),
    operationId: decodeString(value.operationId),
    kind: decodeEnum<QrWriteKind>(value.kind, WRITE_KINDS),
    recoveryPoint: decodeEnum<QrRecoveryPoint>(
      value.recoveryPoint,
      RECOVERY_POINTS,
    ),
    target: decodeString(value.target),
    proposedHash: decodeHash(value.proposedHash),
  };
  if (value.currentHash !== undefined && value.currentHash !== null) {
    preview.currentHash = decodeHash(value.currentHash);
  }
  return { status: "PREVIEWED", ...preview };
}

export function decodeQrExportOutcome(value: unknown): QrExportOutcome {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  const outcome: QrExportOutcome = {
    kind: decodeEnum<QrWriteKind>(value.kind, WRITE_KINDS),
    status: decodeEnum<"SUCCEEDED" | "FAILED">(value.status, [
      "SUCCEEDED",
      "FAILED",
    ]),
    fileState: decodeEnum<QrFileState>(value.fileState, FILE_STATES),
    recoveryPoint: decodeEnum<QrRecoveryPoint>(
      value.recoveryPoint,
      RECOVERY_POINTS,
    ),
    summary: decodeString(value.summary),
  };
  if (value.backupId !== undefined && value.backupId !== null) {
    outcome.backupId = decodeString(value.backupId);
  }
  if (value.error !== undefined && value.error !== null) {
    outcome.error = decodeAppError(value.error);
  }
  return outcome;
}

export function previewQrArgs(input: PreviewQrInput): {
  input: PreviewQrInput;
} {
  return { input: { text: input.text, level: input.level, size: input.size } };
}

export function exportQrArgs(input: ExportQrInput): { input: ExportQrInput } {
  return {
    input: {
      text: input.text,
      level: input.level,
      size: input.size,
      expectedSha256: input.expectedSha256,
    },
  };
}

export function confirmQrExportArgs(input: ConfirmQrExportInput): {
  input: ConfirmQrExportInput;
} {
  return {
    input: { operationId: input.operationId, grantId: input.grantId },
  };
}

export function previewQr(input: PreviewQrInput): Promise<QrPreview> {
  return invokeCommand("preview_qr", decodeQrPreview, previewQrArgs(input));
}

export function prepareQrExport(
  input: ExportQrInput,
): Promise<PrepareQrExportOutcome> {
  return invokeCommand(
    "prepare_qr_export",
    decodePrepareQrExportOutcome,
    exportQrArgs(input),
  );
}

export function confirmQrExport(
  input: ConfirmQrExportInput,
): Promise<QrExportOutcome> {
  return invokeCommand(
    "confirm_qr_export",
    decodeQrExportOutcome,
    confirmQrExportArgs(input),
  );
}
