import {
  createInternalError,
  invokeCommand,
  isRecord,
} from "./core";
import {
  decodeOperationPreview,
  decodeOperationDetails,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

export type ConfigSensitivity = "STANDARD" | "SENSITIVE" | "SECRET";
export type ConfigEntryKind = "FILE" | "DIRECTORY";

export interface ConfigSummary {
  appId: string;
  configId: string;
  displayPath: string;
  format: string;
  sensitivity: ConfigSensitivity;
  writePolicy: string;
  exists: boolean;
  entryKind?: ConfigEntryKind;
  sizeBytes?: number;
  modifiedAtEpochMs?: number;
  mode?: number;
  contentHash?: string;
  symlink?: { targetDisplayPath: string };
}

export interface ConfigDocument extends ConfigSummary {
  content?: string;
  contentRedacted: boolean;
  structured?: Record<string, unknown>;
}

export interface ConfigDiffLine {
  kind: "REMOVED" | "ADDED";
  text: string;
}

export interface ConfigDiff {
  lines: ConfigDiffLine[];
  redacted: boolean;
  truncated: boolean;
}

export interface ConfigWritePreview extends OperationPreview {
  currentHash: string;
  proposedHash: string;
  diff: ConfigDiff;
}

export interface BackupSummary {
  backupId: string;
  appId: string;
  configId: string;
  createdAtEpochMs: number;
  contentHash: string;
  sizeBytes: number;
  mode: number;
}

const SENSITIVITIES: readonly string[] = ["STANDARD", "SENSITIVE", "SECRET"];
const ENTRY_KINDS: readonly string[] = ["FILE", "DIRECTORY"];

function decodeOptionalSafeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeConfigSummary(value: unknown): ConfigSummary {
  if (
    !isRecord(value) ||
    typeof value.appId !== "string" ||
    typeof value.configId !== "string" ||
    typeof value.displayPath !== "string" ||
    typeof value.format !== "string" ||
    typeof value.writePolicy !== "string" ||
    typeof value.exists !== "boolean" ||
    typeof value.sensitivity !== "string" ||
    !SENSITIVITIES.includes(value.sensitivity)
  ) {
    throw createInternalError();
  }
  if (
    value.entryKind !== undefined &&
    value.entryKind !== null &&
    (typeof value.entryKind !== "string" ||
      !ENTRY_KINDS.includes(value.entryKind))
  ) {
    throw createInternalError();
  }
  let symlink: ConfigSummary["symlink"];
  if (value.symlink !== undefined && value.symlink !== null) {
    if (
      !isRecord(value.symlink) ||
      typeof value.symlink.targetDisplayPath !== "string"
    ) {
      throw createInternalError();
    }
    symlink = { targetDisplayPath: value.symlink.targetDisplayPath };
  }

  return {
    appId: value.appId,
    configId: value.configId,
    displayPath: value.displayPath,
    format: value.format,
    sensitivity: value.sensitivity as ConfigSensitivity,
    writePolicy: value.writePolicy,
    exists: value.exists,
    ...(value.entryKind == null
      ? {}
      : { entryKind: value.entryKind as ConfigEntryKind }),
    ...(decodeOptionalSafeInteger(value.sizeBytes) === undefined
      ? {}
      : { sizeBytes: decodeOptionalSafeInteger(value.sizeBytes) }),
    ...(decodeOptionalSafeInteger(value.modifiedAtEpochMs) === undefined
      ? {}
      : { modifiedAtEpochMs: decodeOptionalSafeInteger(value.modifiedAtEpochMs) }),
    ...(decodeOptionalSafeInteger(value.mode) === undefined
      ? {}
      : { mode: decodeOptionalSafeInteger(value.mode) }),
    ...(typeof value.contentHash === "string"
      ? { contentHash: value.contentHash }
      : {}),
    ...(symlink ? { symlink } : {}),
  };
}

function decodeConfigDocument(value: unknown): ConfigDocument {
  const summary = decodeConfigSummary(value);
  if (
    !isRecord(value) ||
    typeof value.contentRedacted !== "boolean" ||
    (value.content !== undefined &&
      value.content !== null &&
      typeof value.content !== "string") ||
    (value.structured !== undefined &&
      value.structured !== null &&
      !isRecord(value.structured))
  ) {
    throw createInternalError();
  }
  return {
    ...summary,
    ...(typeof value.content === "string" ? { content: value.content } : {}),
    contentRedacted: value.contentRedacted,
    ...(isRecord(value.structured)
      ? { structured: { ...value.structured } }
      : {}),
  };
}

export function listConfigs(appId: string): Promise<ConfigSummary[]> {
  return invokeCommand("list_configs", (value) => {
    if (!Array.isArray(value)) throw createInternalError();
    return value.map(decodeConfigSummary);
  }, { appId });
}

export function readConfig(
  appId: string,
  configId: string,
): Promise<ConfigDocument> {
  return invokeCommand("read_config", decodeConfigDocument, {
    key: { appId, configId },
  });
}

function decodeConfigDiff(value: unknown): ConfigDiff {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    typeof value.redacted !== "boolean" ||
    typeof value.truncated !== "boolean"
  ) {
    throw createInternalError();
  }
  const lines = value.lines.map((line) => {
    if (
      !isRecord(line) ||
      (line.kind !== "REMOVED" && line.kind !== "ADDED") ||
      typeof line.text !== "string"
    ) {
      throw createInternalError();
    }
    return { kind: line.kind, text: line.text } satisfies ConfigDiffLine;
  });
  return { lines, redacted: value.redacted, truncated: value.truncated };
}

function decodeConfigWritePreview(value: unknown): ConfigWritePreview {
  const operation = decodeOperationPreview(value);
  if (
    !isRecord(value) ||
    typeof value.currentHash !== "string" ||
    typeof value.proposedHash !== "string"
  ) {
    throw createInternalError();
  }
  return {
    ...operation,
    currentHash: value.currentHash,
    proposedHash: value.proposedHash,
    diff: decodeConfigDiff(value.diff),
  };
}

export function validateConfig(input: {
  appId: string;
  configId: string;
  content: string;
}): Promise<{ valid: true; issues: string[] }> {
  return invokeCommand("validate_config", (value) => {
    if (
      !isRecord(value) ||
      value.valid !== true ||
      !Array.isArray(value.issues) ||
      !value.issues.every((issue) => typeof issue === "string")
    ) {
      throw createInternalError();
    }
    return { valid: true, issues: [...value.issues] };
  }, { input });
}

export function previewConfigWrite(input: {
  appId: string;
  configId: string;
  expectedHash: string;
  content: string;
}): Promise<ConfigWritePreview> {
  return invokeCommand("preview_config_write", decodeConfigWritePreview, {
    input,
  });
}

export function previewStructuredConfigWrite(input: {
  appId: string;
  configId: string;
  expectedHash: string;
  fields: Record<string, unknown>;
}): Promise<ConfigWritePreview> {
  return invokeCommand(
    "preview_structured_config_write",
    decodeConfigWritePreview,
    { input },
  );
}

export function executeConfigWrite(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_config_write", decodeOperationDetails, {
    operationId,
  });
}

function decodeBackupSummary(value: unknown): BackupSummary {
  if (
    !isRecord(value) ||
    typeof value.backupId !== "string" ||
    typeof value.appId !== "string" ||
    typeof value.configId !== "string" ||
    typeof value.contentHash !== "string"
  ) {
    throw createInternalError();
  }
  const createdAtEpochMs = decodeOptionalSafeInteger(value.createdAtEpochMs);
  const sizeBytes = decodeOptionalSafeInteger(value.sizeBytes);
  const mode = decodeOptionalSafeInteger(value.mode);
  if (
    createdAtEpochMs === undefined ||
    sizeBytes === undefined ||
    mode === undefined
  ) {
    throw createInternalError();
  }
  return {
    backupId: value.backupId,
    appId: value.appId,
    configId: value.configId,
    createdAtEpochMs,
    contentHash: value.contentHash,
    sizeBytes,
    mode,
  };
}

export function listConfigBackups(
  appId: string,
  configId: string,
): Promise<BackupSummary[]> {
  return invokeCommand("list_config_backups", (value) => {
    if (!Array.isArray(value)) throw createInternalError();
    return value.map(decodeBackupSummary);
  }, { key: { appId, configId } });
}

export function previewRestoreBackup(input: {
  appId: string;
  configId: string;
  backupId: string;
  expectedHash: string;
}): Promise<ConfigWritePreview> {
  return invokeCommand("preview_restore_backup", decodeConfigWritePreview, {
    input,
  });
}

export function executeRestoreBackup(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_restore_backup", decodeOperationDetails, {
    operationId,
  });
}
