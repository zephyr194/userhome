import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";
import {
  decodeOperationPreview,
  decodeOperationDetails,
  type OperationDetails,
  type OperationPreview,
} from "./operations";
import { CONFIG_FORMATS, type ConfigFormat } from "./catalog";

export type ConfigSensitivity = "STANDARD" | "SENSITIVE" | "SECRET";
export type ConfigEntryKind = "FILE" | "DIRECTORY";
export type ConfigDocumentState =
  | "MISSING"
  | "READY"
  | "INVALID"
  | "REDACTED"
  | "TOO_LARGE"
  | "PERMISSION_DENIED"
  | "UNSAFE_SYMLINK"
  | "UNSUPPORTED_FORMAT"
  | "IO_ERROR";
export type ConfigNextAction =
  | "NONE"
  | "CREATE_FILE"
  | "FIX_CONTENT"
  | "VIEW_REDACTED"
  | "REDUCE_SIZE"
  | "REVIEW_PERMISSIONS"
  | "REPAIR_SYMLINK"
  | "UPDATE_CATALOG"
  | "RETRY";
export type ConfigWritePolicy =
  | "MANAGED_BLOCK"
  | "READ_ONLY"
  | "STRUCTURED_AND_RAW"
  | "RAW_VALIDATED";

export interface ConfigDiagnostic {
  appId: string;
  configId: string;
  variantId: string;
  displayPath: string;
  state: ConfigDocumentState;
  retryable: boolean;
  nextAction: ConfigNextAction;
}

export interface ConfigSummary extends ConfigDiagnostic {
  format: ConfigFormat;
  sensitivity: ConfigSensitivity;
  writePolicy: ConfigWritePolicy;
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

export interface ConfigVariantResolution extends ConfigSummary {
  selected: boolean;
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
const DOCUMENT_STATES: readonly ConfigDocumentState[] = [
  "MISSING",
  "READY",
  "INVALID",
  "REDACTED",
  "TOO_LARGE",
  "PERMISSION_DENIED",
  "UNSAFE_SYMLINK",
  "UNSUPPORTED_FORMAT",
  "IO_ERROR",
];
const NEXT_ACTION_BY_STATE: Readonly<
  Record<ConfigDocumentState, ConfigNextAction>
> = {
  MISSING: "CREATE_FILE",
  READY: "NONE",
  INVALID: "FIX_CONTENT",
  REDACTED: "VIEW_REDACTED",
  TOO_LARGE: "REDUCE_SIZE",
  PERMISSION_DENIED: "REVIEW_PERMISSIONS",
  UNSAFE_SYMLINK: "REPAIR_SYMLINK",
  UNSUPPORTED_FORMAT: "UPDATE_CATALOG",
  IO_ERROR: "RETRY",
};
const WRITE_POLICIES: readonly string[] = [
  "MANAGED_BLOCK",
  "READ_ONLY",
  "STRUCTURED_AND_RAW",
  "RAW_VALIDATED",
];

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

export function decodeSafeDisplayPath(value: unknown): string {
  const prefix =
    typeof value === "string"
      ? [
          "~/",
          "XDG_CONFIG_HOME/",
          "APPLICATION_SUPPORT/",
          "HOMEBREW_PREFIX/",
          "APP_SUPPORT/",
        ].find((candidate) => value.startsWith(candidate))
      : undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    !prefix
  ) {
    throw createInternalError();
  }
  const segments = value.slice(prefix.length).split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeConfigDiagnostic(value: unknown): ConfigDiagnostic {
  if (
    !isRecord(value) ||
    typeof value.appId !== "string" ||
    typeof value.configId !== "string" ||
    typeof value.variantId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.appId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.configId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.variantId) ||
    !DOCUMENT_STATES.includes(value.state as ConfigDocumentState) ||
    typeof value.retryable !== "boolean" ||
    typeof value.nextAction !== "string"
  ) {
    throw createInternalError();
  }
  const state = value.state as ConfigDocumentState;
  if (
    value.nextAction !== NEXT_ACTION_BY_STATE[state] ||
    value.retryable !== (state === "IO_ERROR")
  ) {
    throw createInternalError();
  }
  return {
    appId: value.appId,
    configId: value.configId,
    variantId: value.variantId,
    displayPath: decodeSafeDisplayPath(value.displayPath),
    state,
    retryable: value.retryable,
    nextAction: value.nextAction as ConfigNextAction,
  };
}

function decodeConfigSummary(value: unknown): ConfigSummary {
  const diagnostic = decodeConfigDiagnostic(value);
  if (
    !isRecord(value) ||
    typeof value.format !== "string" ||
    !CONFIG_FORMATS.includes(value.format) ||
    typeof value.writePolicy !== "string" ||
    !WRITE_POLICIES.includes(value.writePolicy) ||
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
  if (
    value.writePolicy === "READ_ONLY" &&
    value.contentHash !== undefined &&
    value.contentHash !== null
  ) {
    throw createInternalError();
  }
  if (
    (!["READY", "REDACTED"].includes(diagnostic.state) &&
      value.contentHash != null) ||
    (["READY", "REDACTED"].includes(diagnostic.state) &&
      (!value.exists || value.entryKind == null)) ||
    (diagnostic.state === "MISSING" &&
      (value.exists ||
        value.entryKind != null ||
        value.sizeBytes != null ||
        value.modifiedAtEpochMs != null ||
        value.mode != null ||
        value.symlink != null))
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
    symlink = {
      targetDisplayPath: decodeSafeDisplayPath(
        value.symlink.targetDisplayPath,
      ),
    };
  }

  return {
    ...diagnostic,
    format: value.format as ConfigFormat,
    sensitivity: value.sensitivity as ConfigSensitivity,
    writePolicy: value.writePolicy as ConfigWritePolicy,
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
  if (
    ((summary.state === "READY" || summary.state === "REDACTED") &&
      !summary.exists) ||
    (summary.state === "MISSING" && summary.exists) ||
    (summary.state === "REDACTED" && value.contentRedacted !== true) ||
    (summary.state === "READY" && value.contentRedacted !== false) ||
    (!["READY", "REDACTED"].includes(summary.state) &&
      (value.content != null ||
        value.structured != null ||
        value.contentRedacted !== false))
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
  variantId?: string,
): Promise<ConfigDocument> {
  return invokeCommand("read_config", decodeConfigDocument, {
    key: { appId, configId, ...(variantId ? { variantId } : {}) },
  });
}

export function resolveConfigVariants(
  appId: string,
  configId: string,
): Promise<ConfigVariantResolution[]> {
  return invokeCommand("resolve_config_variants", (value) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
      throw createInternalError();
    }
    const variants = value.map((variant) => {
      const summary = decodeConfigSummary(variant);
      if (!isRecord(variant) || typeof variant.selected !== "boolean") {
        throw createInternalError();
      }
      return { ...summary, selected: variant.selected };
    });
    if (
      new Set(variants.map((variant) => variant.variantId)).size !==
        variants.length ||
      variants.filter((variant) => variant.selected).length !== 1
    ) {
      throw createInternalError();
    }
    return variants;
  }, { key: { appId, configId } });
}

export function diagnoseConfig(
  appId: string,
  configId: string,
  variantId?: string,
): Promise<ConfigDiagnostic> {
  return invokeCommand("diagnose_config", decodeConfigDiagnostic, {
    key: { appId, configId, ...(variantId ? { variantId } : {}) },
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
