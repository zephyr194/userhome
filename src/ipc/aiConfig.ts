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

// Claude Code settings read. Mirrors ai_config/read.rs; the view carries masked
// values only, so the decoder accepts any JSON value but nothing else untyped.

export const CLAUDE_LAYER_STATE_KINDS = [
  "loaded",
  "present",
  "missing",
  "notSelected",
  "notApplicable",
  "notReadable",
  "existsUnreadable",
  "notRegularFile",
  "tooLarge",
  "malformed",
] as const;
export type ClaudeLayerStateKind = (typeof CLAUDE_LAYER_STATE_KINDS)[number];

export interface ClaudeLayerState {
  readonly kind: ClaudeLayerStateKind;
  readonly message: string | null;
}

export interface ClaudeLayerReport {
  readonly id: string;
  readonly layer: string;
  readonly location: string;
  readonly precedence: number | null;
  readonly state: ClaudeLayerState;
}

export interface ClaudeDefinedIn {
  readonly layerId: string;
  readonly overridden: boolean;
}

export interface ClaudeSettingEntry {
  readonly key: string;
  readonly documented: boolean;
  readonly valueType: string | null;
  readonly coverage: string | null;
  readonly value: unknown;
  readonly masked: boolean;
  readonly merged: boolean;
  readonly winner: string | null;
  readonly definedIn: readonly ClaudeDefinedIn[];
}

export interface ClaudeReadWarning {
  readonly layerId: string;
  readonly key: string;
  readonly message: string;
}

export interface ClaudeReadView {
  readonly toolId: string;
  readonly layers: readonly ClaudeLayerReport[];
  readonly entries: readonly ClaudeSettingEntry[];
  readonly warnings: readonly ClaudeReadWarning[];
}

export interface ClaudeSnapshotSummary {
  readonly toolId: string;
  readonly displayName: string;
  readonly sourceUrl: string;
  readonly retrievedOn: string;
  readonly documentedVersion: string;
  readonly settingCount: number;
  readonly resourceCount: number;
  readonly editable: number;
  readonly displayOnly: number;
  readonly versionUnknown: number;
  readonly notApplicable: number;
  readonly unsupported: number;
  readonly unknownValueType: number;
}

const CLAUDE_VIEW_KEYS = ["toolId", "layers", "entries", "warnings"] as const;
const CLAUDE_LAYER_KEYS = ["id", "layer", "location", "precedence", "state"] as const;
const CLAUDE_ENTRY_KEYS = [
  "key",
  "documented",
  "valueType",
  "coverage",
  "value",
  "masked",
  "merged",
  "winner",
  "definedIn",
] as const;
const CLAUDE_DEFINED_KEYS = ["layerId", "overridden"] as const;
const CLAUDE_WARNING_KEYS = ["layerId", "key", "message"] as const;
const CLAUDE_SNAPSHOT_KEYS = [
  "toolId",
  "displayName",
  "sourceUrl",
  "retrievedOn",
  "documentedVersion",
  "settingCount",
  "resourceCount",
  "editable",
  "displayOnly",
  "versionUnknown",
  "notApplicable",
  "unsupported",
  "unknownValueType",
] as const;
const CLAUDE_COVERAGE_LABELS = [
  "editable",
  "displayOnly",
  "notApplicable",
  "versionUnknown",
  "unsupported",
] as const;
const CLAUDE_VALUE_TYPE_LABELS = [
  "string",
  "boolean",
  "number",
  "stringArray",
  "object",
  "enum",
  "unknown",
] as const;
const CLAUDE_LAYER_LABELS = [
  "managed",
  "projectLocal",
  "projectShared",
  "userLevel",
] as const;
const MAX_CLAUDE_TEXT_LENGTH = 512;
const MAX_CLAUDE_COUNT = 100_000;

function requireCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_CLAUDE_COUNT) {
    throw decodeFailure();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw decodeFailure();
  return value;
}

function nullableOneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return value === null ? null : requireOneOf(values, value);
}

function decodeLayerState(value: unknown): ClaudeLayerState {
  const record = requireRecord(value);
  const kind = requireOneOf(CLAUDE_LAYER_STATE_KINDS, record.state);
  if (kind === "malformed") {
    requireExactKeys(record, ["state", "message"]);
    return { kind, message: requireText(record.message, MAX_CLAUDE_TEXT_LENGTH) };
  }
  requireExactKeys(record, ["state"]);
  return { kind, message: null };
}

function decodeLayerReport(value: unknown): ClaudeLayerReport {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_LAYER_KEYS);
  const precedence = record.precedence === null ? null : requireCount(record.precedence);
  if (precedence !== null && precedence < 1) throw decodeFailure();
  return {
    id: requireText(record.id, 128),
    layer: requireOneOf(CLAUDE_LAYER_LABELS, record.layer),
    location: requireText(record.location, MAX_CLAUDE_TEXT_LENGTH),
    precedence,
    state: decodeLayerState(record.state),
  };
}

function decodeDefinedIn(value: unknown): ClaudeDefinedIn {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_DEFINED_KEYS);
  return {
    layerId: requireText(record.layerId, 128),
    overridden: requireBoolean(record.overridden),
  };
}

function decodeSettingEntry(value: unknown): ClaudeSettingEntry {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_ENTRY_KEYS);
  if (!Array.isArray(record.definedIn) || record.definedIn.length === 0) {
    throw decodeFailure();
  }
  const documented = requireBoolean(record.documented);
  const valueType = nullableOneOf(CLAUDE_VALUE_TYPE_LABELS, record.valueType);
  const coverage = nullableOneOf(CLAUDE_COVERAGE_LABELS, record.coverage);
  if (documented !== (valueType !== null && coverage !== null)) throw decodeFailure();
  return {
    key: requireText(record.key, 256),
    documented,
    valueType,
    coverage,
    value: record.value,
    masked: requireBoolean(record.masked),
    merged: requireBoolean(record.merged),
    winner: record.winner === null ? null : requireText(record.winner, 128),
    definedIn: record.definedIn.map(decodeDefinedIn),
  };
}

function decodeWarning(value: unknown): ClaudeReadWarning {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_WARNING_KEYS);
  return {
    layerId: requireText(record.layerId, 128),
    key: requireText(record.key, 256),
    message: requireText(record.message, MAX_CLAUDE_TEXT_LENGTH),
  };
}

export function decodeClaudeReadView(value: unknown): ClaudeReadView {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_VIEW_KEYS);
  if (record.toolId !== "claude-code") throw decodeFailure();
  if (!Array.isArray(record.layers) || !Array.isArray(record.entries) || !Array.isArray(record.warnings)) {
    throw decodeFailure();
  }
  return {
    toolId: "claude-code",
    layers: record.layers.map(decodeLayerReport),
    entries: record.entries.map(decodeSettingEntry),
    warnings: record.warnings.map(decodeWarning),
  };
}

export function decodeClaudeSnapshotSummary(value: unknown): ClaudeSnapshotSummary {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_SNAPSHOT_KEYS);
  if (record.toolId !== "claude-code") throw decodeFailure();
  return {
    toolId: "claude-code",
    displayName: requireText(record.displayName, 64),
    sourceUrl: requireHttpsUrl(record.sourceUrl),
    retrievedOn: requireText(record.retrievedOn, 10),
    documentedVersion: requireText(record.documentedVersion, 32),
    settingCount: requireCount(record.settingCount),
    resourceCount: requireCount(record.resourceCount),
    editable: requireCount(record.editable),
    displayOnly: requireCount(record.displayOnly),
    versionUnknown: requireCount(record.versionUnknown),
    notApplicable: requireCount(record.notApplicable),
    unsupported: requireCount(record.unsupported),
    unknownValueType: requireCount(record.unknownValueType),
  };
}

export function readClaudeSettings(projectGrantId: string | null): Promise<ClaudeReadView> {
  return invokeCommand("ai_config_claude_read", decodeClaudeReadView, {
    projectGrantId,
  });
}

export function getClaudeSnapshot(): Promise<ClaudeSnapshotSummary> {
  return invokeCommand("ai_config_claude_snapshot", decodeClaudeSnapshotSummary);
}
