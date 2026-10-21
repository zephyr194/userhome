import { createInternalError, invokeCommand, isRecord, type AppError } from "./core";

// Wire shapes mirror src-tauri/src/app_config/{registry,discover,read}.rs and
// commands/app_config.rs. The frontend sends an entry id and nothing else; it
// never sends a path. Every response is decoded strictly and fails closed.

export const APP_CONFIG_CATEGORIES = [
  "editor",
  "aiClient",
  "terminal",
  "developerTool",
  "system",
] as const;
export type AppConfigCategory = (typeof APP_CONFIG_CATEGORIES)[number];

export const APP_CONFIG_FORMATS = [
  "json",
  "jsonc",
  "toml",
  "plist",
  "ini",
  "dotenv",
  "text",
] as const;
export type AppConfigFormat = (typeof APP_CONFIG_FORMATS)[number];

export const APP_CONFIG_CAPABILITIES = [
  "discoverOnly",
  "readOnly",
  "writable",
] as const;
export type AppConfigCapability = (typeof APP_CONFIG_CAPABILITIES)[number];

export const APP_CONFIG_SENSITIVITIES = [
  "none",
  "sensitiveKeys",
  "credentials",
] as const;
export type AppConfigSensitivity = (typeof APP_CONFIG_SENSITIVITIES)[number];

export const APP_CONFIG_READ_FAILURES = [
  "tooLarge",
  "parseError",
  "unreadable",
] as const;
export type AppConfigReadFailure = (typeof APP_CONFIG_READ_FAILURES)[number];

const APP_CONFIG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_APP_CONFIG_ID_LENGTH = 64;

export function isAppConfigId(value: string): boolean {
  return (
    value.length <= MAX_APP_CONFIG_ID_LENGTH &&
    APP_CONFIG_ID_PATTERN.test(value)
  );
}

export interface AppConfigEntrySummary {
  id: string;
  name: string;
  category: AppConfigCategory;
  displayPath: string;
  format: AppConfigFormat;
  capability: AppConfigCapability;
  sensitivity: AppConfigSensitivity;
  metadataOnly: boolean;
  sourceUrl: string;
  verifiedOn: string;
}

export interface AppConfigFileMeta {
  size: number;
  modifiedUnixMillis: number;
}

export type AppConfigUnavailableStatus =
  | { status: "notFound" }
  | { status: "symlinkOrNonRegular" }
  | { status: "inaccessible" }
  | { status: "outOfBounds" };

export type AppConfigProbeStatus =
  | ({ status: "found" } & AppConfigFileMeta)
  | AppConfigUnavailableStatus;

export interface AppConfigListItem {
  summary: AppConfigEntrySummary;
  probe: AppConfigProbeStatus;
}

export interface AppConfigParseWarning {
  line: number;
  message: string;
}

export interface AppConfigContentView {
  text: string;
  redacted: boolean;
  withheldLines: number;
  warnings: AppConfigParseWarning[];
}

export type AppConfigReadResult =
  | { outcome: "content"; view: AppConfigContentView }
  | { outcome: "metadataOnly"; meta: AppConfigFileMeta }
  | { outcome: "unavailable"; status: AppConfigUnavailableStatus }
  | { outcome: "failed"; kind: AppConfigReadFailure };

function decodeFailure(): AppError {
  return createInternalError();
}

function requireOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw decodeFailure();
  }
  return value as T;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw decodeFailure();
  return value;
}

function requireNonEmptyString(value: unknown): string {
  const text = requireString(value);
  if (text.trim().length === 0) throw decodeFailure();
  return text;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw decodeFailure();
  return value;
}

function requireCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw decodeFailure();
  }
  return value;
}

function requireInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw decodeFailure();
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw decodeFailure();
  return value;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw decodeFailure();
  return value;
}

export function decodeAppConfigFileMeta(value: unknown): AppConfigFileMeta {
  const record = requireRecord(value);
  return {
    size: requireCount(record.size),
    modifiedUnixMillis: requireInteger(record.modifiedUnixMillis),
  };
}

export function decodeAppConfigProbeStatus(value: unknown): AppConfigProbeStatus {
  const record = requireRecord(value);
  switch (record.status) {
    case "found":
      return { status: "found", ...decodeAppConfigFileMeta(record) };
    case "notFound":
    case "symlinkOrNonRegular":
    case "inaccessible":
    case "outOfBounds":
      return { status: record.status };
    default:
      throw decodeFailure();
  }
}

function decodeUnavailableStatus(value: unknown): AppConfigUnavailableStatus {
  const status = decodeAppConfigProbeStatus(value);
  if (status.status === "found") throw decodeFailure();
  return status;
}

export function decodeAppConfigEntrySummary(
  value: unknown,
): AppConfigEntrySummary {
  const record = requireRecord(value);
  const id = requireString(record.id);
  if (!isAppConfigId(id)) throw decodeFailure();
  return {
    id,
    name: requireNonEmptyString(record.name),
    category: requireOneOf(APP_CONFIG_CATEGORIES, record.category),
    displayPath: requireNonEmptyString(record.displayPath),
    format: requireOneOf(APP_CONFIG_FORMATS, record.format),
    capability: requireOneOf(APP_CONFIG_CAPABILITIES, record.capability),
    sensitivity: requireOneOf(APP_CONFIG_SENSITIVITIES, record.sensitivity),
    metadataOnly: requireBoolean(record.metadataOnly),
    sourceUrl: requireNonEmptyString(record.sourceUrl),
    verifiedOn: requireNonEmptyString(record.verifiedOn),
  };
}

export function decodeAppConfigList(value: unknown): AppConfigListItem[] {
  return requireArray(value).map((item) => {
    const record = requireRecord(item);
    return {
      summary: decodeAppConfigEntrySummary(record.summary),
      probe: decodeAppConfigProbeStatus(record.probe),
    };
  });
}

function decodeParseWarning(value: unknown): AppConfigParseWarning {
  const record = requireRecord(value);
  return {
    line: requireCount(record.line),
    message: requireString(record.message),
  };
}

function decodeContentView(value: unknown): AppConfigContentView {
  const record = requireRecord(value);
  return {
    text: requireString(record.text),
    redacted: requireBoolean(record.redacted),
    withheldLines: requireCount(record.withheldLines),
    warnings: requireArray(record.warnings).map(decodeParseWarning),
  };
}

export function decodeAppConfigReadResult(value: unknown): AppConfigReadResult {
  const record = requireRecord(value);
  switch (record.outcome) {
    case "content":
      return { outcome: "content", view: decodeContentView(record.view) };
    case "metadataOnly":
      return {
        outcome: "metadataOnly",
        meta: decodeAppConfigFileMeta(record.meta),
      };
    case "unavailable":
      return { outcome: "unavailable", status: decodeUnavailableStatus(record.status) };
    case "failed":
      return {
        outcome: "failed",
        kind: requireOneOf(APP_CONFIG_READ_FAILURES, record.kind),
      };
    default:
      throw decodeFailure();
  }
}

export function listAppConfigEntries(): Promise<AppConfigListItem[]> {
  return invokeCommand("app_config_list", decodeAppConfigList);
}

/** Only a registry id leaves the frontend; the backend resolves the path. */
export async function readAppConfigEntry(
  id: string,
): Promise<AppConfigReadResult> {
  if (!isAppConfigId(id)) {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "未知的应用配置条目。",
      retryable: false,
    };
    throw error;
  }
  return invokeCommand("app_config_read", decodeAppConfigReadResult, { id });
}
