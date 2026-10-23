import { createInternalError, invokeCommand, isRecord, type AppError } from "./core";

// Wire shapes mirror src-tauri/src/app_config/{registry,discover,read}.rs and
// commands/app_config.rs. The frontend sends an entry id and nothing else; it
// never sends a path. Every response is decoded strictly and fails closed.

export const APP_CONFIG_CATEGORIES = [
  "editor",
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

export const APP_CONFIG_FIELD_KINDS = [
  "string",
  "bool",
  "integer",
  "number",
  "enum",
] as const;
export type AppConfigFieldKind = (typeof APP_CONFIG_FIELD_KINDS)[number];

export type AppConfigFieldPattern =
  | { kind: "containsSeparator"; separator: string }
  | { kind: "charset"; allowed: string };

export interface AppConfigFieldSpec {
  path: string;
  label: string;
  description: string;
  kind: AppConfigFieldKind;
  enumValues: string[];
  min: number | null;
  max: number | null;
  pattern: AppConfigFieldPattern | null;
  default: string | null;
  sensitive: boolean;
}

export interface AppConfigSchema {
  visualSupported: boolean;
  advancedSupported: boolean;
  formatLabel: string;
  fields: AppConfigFieldSpec[];
}

export type AppConfigFieldValue = string | number | boolean | null;

export interface AppConfigFieldReadout {
  path: string;
  present: boolean;
  value: AppConfigFieldValue;
}

export interface AppConfigEditRead {
  fields: AppConfigFieldReadout[];
  rawText: string | null;
  hash: string;
  rawBlockedReason: string | null;
}

export type AppConfigEditMode = "fields" | "raw";

export interface AppConfigFieldChange {
  path: string;
  value: AppConfigFieldValue;
}

export interface AppConfigPreviewInput {
  id: string;
  mode: AppConfigEditMode;
  changes: AppConfigFieldChange[];
  rawText: string | null;
  expectedHash: string;
}

export interface AppConfigPreviewIssue {
  path?: string;
  line?: number;
  message: string;
}

export interface AppConfigPreviewResult {
  ok: boolean;
  errors: AppConfigPreviewIssue[];
  diff: string;
  warnings: string[];
  previewToken: string | null;
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw decodeFailure();
  }
  return value;
}

function requireNullableNumber(value: unknown): number | null {
  return value === null ? null : requireNumber(value);
}

function requireNullableString(value: unknown): string | null {
  return value === null ? null : requireString(value);
}

function decodeFieldPattern(value: unknown): AppConfigFieldPattern | null {
  if (value === null) return null;
  const record = requireRecord(value);
  switch (record.kind) {
    case "containsSeparator":
      return {
        kind: "containsSeparator",
        separator: requireNonEmptyString(record.separator),
      };
    case "charset":
      return { kind: "charset", allowed: requireNonEmptyString(record.allowed) };
    default:
      throw decodeFailure();
  }
}

function decodeFieldSpec(value: unknown): AppConfigFieldSpec {
  const record = requireRecord(value);
  const path = requireNonEmptyString(record.path);
  if (!/^[A-Za-z0-9]+(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(path)) {
    throw decodeFailure();
  }
  return {
    path,
    label: requireNonEmptyString(record.label),
    description: requireNonEmptyString(record.description),
    kind: requireOneOf(APP_CONFIG_FIELD_KINDS, record.kind),
    enumValues: requireArray(record.enumValues).map(requireNonEmptyString),
    min: requireNullableNumber(record.min),
    max: requireNullableNumber(record.max),
    pattern: decodeFieldPattern(record.pattern),
    default: requireNullableString(record.default),
    sensitive: requireBoolean(record.sensitive),
  };
}

export function decodeAppConfigSchema(value: unknown): AppConfigSchema {
  const record = requireRecord(value);
  return {
    visualSupported: requireBoolean(record.visualSupported),
    advancedSupported: requireBoolean(record.advancedSupported),
    formatLabel: requireNonEmptyString(record.formatLabel),
    fields: requireArray(record.fields).map(decodeFieldSpec),
  };
}

function decodeFieldValue(value: unknown): AppConfigFieldValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return requireNumber(value);
}

function decodeFieldReadout(value: unknown): AppConfigFieldReadout {
  const record = requireRecord(value);
  return {
    path: requireNonEmptyString(record.path),
    present: requireBoolean(record.present),
    value: decodeFieldValue(record.value),
  };
}

export function decodeAppConfigEditRead(value: unknown): AppConfigEditRead {
  const record = requireRecord(value);
  return {
    fields: requireArray(record.fields).map(decodeFieldReadout),
    rawText: requireNullableString(record.rawText),
    hash: requireString(record.hash),
    rawBlockedReason: requireNullableString(record.rawBlockedReason),
  };
}

function decodePreviewIssue(value: unknown): AppConfigPreviewIssue {
  const record = requireRecord(value);
  const issue: AppConfigPreviewIssue = {
    message: requireNonEmptyString(record.message),
  };
  if (record.path !== undefined) issue.path = requireNonEmptyString(record.path);
  if (record.line !== undefined) issue.line = requireCount(record.line);
  return issue;
}

export function decodeAppConfigPreviewResult(
  value: unknown,
): AppConfigPreviewResult {
  const record = requireRecord(value);
  return {
    ok: requireBoolean(record.ok),
    errors: requireArray(record.errors).map(decodePreviewIssue),
    diff: requireString(record.diff),
    warnings: requireArray(record.warnings).map(requireString),
    previewToken: requireNullableString(record.previewToken),
  };
}

function requireEntryId(id: string): void {
  if (!isAppConfigId(id)) {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "未知的应用配置条目。",
      retryable: false,
    };
    throw error;
  }
}

export async function getAppConfigSchema(id: string): Promise<AppConfigSchema> {
  requireEntryId(id);
  return invokeCommand("app_config_schema", decodeAppConfigSchema, { id });
}

export async function readAppConfigForEdit(
  id: string,
): Promise<AppConfigEditRead> {
  requireEntryId(id);
  return invokeCommand("app_config_read_for_edit", decodeAppConfigEditRead, {
    id,
  });
}

export async function previewAppConfigEdit(
  input: AppConfigPreviewInput,
): Promise<AppConfigPreviewResult> {
  requireEntryId(input.id);
  return invokeCommand(
    "app_config_preview_edit",
    decodeAppConfigPreviewResult,
    { input },
  );
}

export async function confirmAppConfigEdit(
  previewToken: string,
): Promise<AppConfigReadResult> {
  if (previewToken.trim().length === 0) {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "预览已失效，请重新预览。",
      retryable: false,
    };
    throw error;
  }
  return invokeCommand("app_config_confirm_edit", decodeAppConfigReadResult, {
    input: { previewToken },
  });
}
