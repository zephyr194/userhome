import { createInternalError, hasControlCharacters, invokeCommand, isRecord } from "./core";

// Wire shapes mirror src-tauri/src/ai_config/detect.rs and
// commands/ai_config.rs. The command takes no arguments, and every response is
// decoded strictly: an unexpected key, value or combination fails closed.

export const AI_TOOL_IDS = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "copilot-cli",
] as const;
export type AiToolId = (typeof AI_TOOL_IDS)[number];

export const AI_INSTALL_STATUSES = ["found", "missing", "invalid"] as const;
export type AiInstallStatus = (typeof AI_INSTALL_STATUSES)[number];

export const AI_INVALID_REASONS = [
  "unreadable",
  "outsideRoot",
  "notRegularFile",
  "notExecutable",
  "groupOrWorldWritable",
] as const;
export type AiInvalidReason = (typeof AI_INVALID_REASONS)[number];

export const AI_CONFIG_PRESENCES = [
  "found",
  "notFound",
  "unavailable",
  "notRegistered",
] as const;
export type AiConfigPresence = (typeof AI_CONFIG_PRESENCES)[number];

const TOOL_REPORT_KEYS = [
  "id",
  "displayName",
  "installStatus",
  "displayPath",
  "invalidReason",
  "version",
  "configPresence",
  "references",
  "verificationNote",
] as const;
const MAX_REFERENCES = 4;
const MAX_VERSION_LENGTH = 120;
const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_VERIFICATION_NOTE_LENGTH = 200;

export interface AiToolReport {
  id: AiToolId;
  displayName: string;
  installStatus: AiInstallStatus;
  displayPath: string | null;
  invalidReason: AiInvalidReason | null;
  version: string | null;
  configPresence: AiConfigPresence;
  references: string[];
  verificationNote: string;
}

export interface AiConfigReport {
  tools: AiToolReport[];
}

function decodeFailure() {
  return createInternalError();
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw decodeFailure();
  return value;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some((key) => !(key in record))) {
    throw decodeFailure();
  }
}

function requireOneOf<T extends string>(values: readonly T[], value: unknown): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw decodeFailure();
  }
  return value as T;
}

function requireText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw decodeFailure();
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength || hasControlCharacters(value)) {
    throw decodeFailure();
  }
  return value;
}

function requireHttpsUrl(value: unknown): string {
  const url = requireText(value, 300);
  if (!url.startsWith("https://") || /\s/.test(url)) throw decodeFailure();
  return url;
}

function nullableText(value: unknown, maxLength: number): string | null {
  return value === null ? null : requireText(value, maxLength);
}

function decodeToolReport(value: unknown, expectedId: AiToolId): AiToolReport {
  const record = requireRecord(value);
  requireExactKeys(record, TOOL_REPORT_KEYS);
  const id = requireOneOf(AI_TOOL_IDS, record.id);
  if (id !== expectedId) throw decodeFailure();
  const installStatus = requireOneOf(AI_INSTALL_STATUSES, record.installStatus);
  const displayPath = nullableText(record.displayPath, 512);
  const invalidReason =
    record.invalidReason === null
      ? null
      : requireOneOf(AI_INVALID_REASONS, record.invalidReason);
  const version = nullableText(record.version, MAX_VERSION_LENGTH);

  if (installStatus === "found") {
    if (displayPath === null || invalidReason !== null) throw decodeFailure();
  } else if (installStatus === "invalid") {
    if (displayPath === null || invalidReason === null || version !== null) {
      throw decodeFailure();
    }
  } else if (displayPath !== null || invalidReason !== null || version !== null) {
    throw decodeFailure();
  }

  if (!Array.isArray(record.references)) throw decodeFailure();
  if (record.references.length === 0 || record.references.length > MAX_REFERENCES) {
    throw decodeFailure();
  }

  return {
    id,
    displayName: requireText(record.displayName, MAX_DISPLAY_NAME_LENGTH),
    installStatus,
    displayPath,
    invalidReason,
    version,
    configPresence: requireOneOf(AI_CONFIG_PRESENCES, record.configPresence),
    references: record.references.map(requireHttpsUrl),
    verificationNote: requireText(record.verificationNote, MAX_VERIFICATION_NOTE_LENGTH),
  };
}

export function decodeAiConfigReport(value: unknown): AiConfigReport {
  const record = requireRecord(value);
  requireExactKeys(record, ["tools"]);
  if (!Array.isArray(record.tools) || record.tools.length !== AI_TOOL_IDS.length) {
    throw decodeFailure();
  }
  return {
    tools: record.tools.map((tool, index) =>
      decodeToolReport(tool, AI_TOOL_IDS[index]),
    ),
  };
}

export function detectAiConfig(): Promise<AiConfigReport> {
  return invokeCommand("ai_config_detect", decodeAiConfigReport);
}
