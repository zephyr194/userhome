import {
  createInternalError,
  decodeAppError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";

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

// Claude Code settings edit. Mirrors commands/ai_config.rs. The frontend names a
// settings-file grant id, a key and a JSON value; it never sends or receives a path.

export const CLAUDE_EDIT_ACTIONS = [
  "set",
  "restoreDefault",
  "setNull",
] as const;
export type ClaudeEditAction = (typeof CLAUDE_EDIT_ACTIONS)[number];

const CLAUDE_WRITE_KINDS = ["REPLACE", "CREATE"] as const;
export type ClaudeWriteKind = (typeof CLAUDE_WRITE_KINDS)[number];

const CLAUDE_RECOVERY_POINTS = [
  "BACKUP",
  "NONE_CREATED",
  "NONE_UNAVAILABLE",
] as const;
export type ClaudeRecoveryPoint = (typeof CLAUDE_RECOVERY_POINTS)[number];

const CLAUDE_OUTCOME_STATUSES = ["SUCCEEDED", "FAILED"] as const;
export type ClaudeOutcomeStatus = (typeof CLAUDE_OUTCOME_STATUSES)[number];

const CLAUDE_FILE_STATES = [
  "WRITTEN",
  "UNCHANGED",
  "RESTORED",
  "RESTORE_FAILED",
  "CREATED_REMOVED",
  "CREATED_REMOVE_FAILED",
  "UNKNOWN",
] as const;
export type ClaudeFileState = (typeof CLAUDE_FILE_STATES)[number];

const CLAUDE_DIFF_KINDS = ["REMOVED", "ADDED"] as const;
export type ClaudeDiffKind = (typeof CLAUDE_DIFF_KINDS)[number];

export interface ClaudeEditItem {
  readonly keyPath: string;
  readonly valueType: string;
  readonly allowedValues: readonly string[];
  readonly editable: boolean;
  readonly reason: string | null;
  readonly verifiedVersion: string | null;
  readonly description: string;
  readonly descriptionTruncated: boolean;
  readonly defaultNote: string;
  readonly sourceUrl: string;
  readonly sourceRetrievedOn: string;
}

export interface ClaudeEditCatalog {
  readonly detectedVersion: string | null;
  readonly items: readonly ClaudeEditItem[];
}

export interface ClaudeEditDiffLine {
  readonly kind: ClaudeDiffKind;
  readonly text: string;
}

export interface ClaudeEditDiff {
  readonly lines: readonly ClaudeEditDiffLine[];
  readonly redacted: boolean;
  readonly truncated: boolean;
}

export interface ClaudeEditPreview {
  readonly operationId: string;
  readonly summary: string;
  readonly effects: readonly string[];
  readonly expiresAt: string;
  readonly keyPath: string;
  readonly action: ClaudeEditAction;
  readonly kind: ClaudeWriteKind;
  readonly recoveryPoint: ClaudeRecoveryPoint;
  readonly diff: ClaudeEditDiff;
  readonly reloadNote: string;
}

export interface ClaudeEditOutcome {
  readonly kind: ClaudeWriteKind;
  readonly status: ClaudeOutcomeStatus;
  readonly fileState: ClaudeFileState;
  readonly recoveryPoint: ClaudeRecoveryPoint;
  readonly backupId: string | null;
  readonly summary: string;
  readonly error: AppError | null;
}

export interface ClaudeEditResult {
  readonly operationId: string;
  readonly outcome: ClaudeEditOutcome;
  readonly reloadNote: string;
}

export interface ClaudeEditRequest {
  readonly grantId: string;
  readonly keyPath: string;
  readonly action: ClaudeEditAction;
  readonly value?: boolean | string;
}

const CLAUDE_EDIT_ITEM_KEYS = [
  "keyPath",
  "valueType",
  "allowedValues",
  "editable",
  "reason",
  "verifiedVersion",
  "description",
  "descriptionTruncated",
  "defaultNote",
  "sourceUrl",
  "sourceRetrievedOn",
] as const;
const CLAUDE_EDIT_CATALOG_KEYS = ["detectedVersion", "items"] as const;
const CLAUDE_EDIT_PREVIEW_KEYS = [
  "operationId",
  "summary",
  "effects",
  "expiresAt",
  "keyPath",
  "action",
  "kind",
  "recoveryPoint",
  "diff",
  "reloadNote",
] as const;
const CLAUDE_EDIT_DIFF_KEYS = ["lines", "redacted", "truncated"] as const;
const CLAUDE_EDIT_DIFF_LINE_KEYS = ["kind", "text"] as const;
const CLAUDE_EDIT_RESULT_KEYS = [
  "operationId",
  "outcome",
  "reloadNote",
] as const;
const CLAUDE_EDIT_OUTCOME_REQUIRED_KEYS = [
  "kind",
  "status",
  "fileState",
  "recoveryPoint",
  "summary",
] as const;
const CLAUDE_EDIT_OUTCOME_OPTIONAL_KEYS = ["backupId", "error"] as const;
const MAX_EDIT_TEXT_LENGTH = 2_000;
const MAX_EDIT_KEY_LENGTH = 256;

function requireExactKeysWithOptional(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
) {
  const allowed = [...required, ...optional];
  const actual = Object.keys(record);
  if (actual.some((key) => !allowed.includes(key))) throw decodeFailure();
  if (required.some((key) => !(key in record))) throw decodeFailure();
}

function requireBooleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw decodeFailure();
  return value;
}

const MAX_CATALOG_TEXT_CODE_POINTS = 200;
const RETRIEVED_ON_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireCatalogText(value: unknown): string {
  if (typeof value !== "string") throw decodeFailure();
  if (
    value.trim().length === 0 ||
    Array.from(value).length > MAX_CATALOG_TEXT_CODE_POINTS ||
    hasControlCharacters(value)
  ) {
    throw decodeFailure();
  }
  return value;
}

function requireRetrievedOn(value: unknown): string {
  if (typeof value !== "string" || !RETRIEVED_ON_PATTERN.test(value)) {
    throw decodeFailure();
  }
  return value;
}

function requireEditText(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw decodeFailure();
  }
  return value;
}

export function decodeClaudeEditCatalog(value: unknown): ClaudeEditCatalog {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_EDIT_CATALOG_KEYS);
  if (!Array.isArray(record.items) || record.items.length > MAX_CLAUDE_COUNT) {
    throw decodeFailure();
  }
  return {
    detectedVersion: nullableText(record.detectedVersion, MAX_VERSION_LENGTH),
    items: record.items.map(decodeClaudeEditItem),
  };
}

function decodeClaudeEditItem(value: unknown): ClaudeEditItem {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_EDIT_ITEM_KEYS);
  if (!Array.isArray(record.allowedValues)) throw decodeFailure();
  const editable = requireBooleanValue(record.editable);
  const reason =
    record.reason === null
      ? null
      : requireText(record.reason, MAX_CLAUDE_TEXT_LENGTH);
  if (editable !== (reason === null)) throw decodeFailure();
  return {
    keyPath: requireText(record.keyPath, MAX_EDIT_KEY_LENGTH),
    valueType: requireOneOf(CLAUDE_VALUE_TYPE_LABELS, record.valueType),
    allowedValues: record.allowedValues.map((item) => requireText(item, 128)),
    editable,
    reason,
    verifiedVersion: nullableText(record.verifiedVersion, MAX_VERSION_LENGTH),
    description: requireCatalogText(record.description),
    descriptionTruncated: requireBooleanValue(record.descriptionTruncated),
    defaultNote: requireCatalogText(record.defaultNote),
    sourceUrl: requireHttpsUrl(record.sourceUrl),
    sourceRetrievedOn: requireRetrievedOn(record.sourceRetrievedOn),
  };
}

function decodeClaudeEditDiff(value: unknown): ClaudeEditDiff {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_EDIT_DIFF_KEYS);
  if (!Array.isArray(record.lines) || record.lines.length > 200)
    throw decodeFailure();
  return {
    lines: record.lines.map((line) => {
      const entry = requireRecord(line);
      requireExactKeys(entry, CLAUDE_EDIT_DIFF_LINE_KEYS);
      return {
        kind: requireOneOf(CLAUDE_DIFF_KINDS, entry.kind),
        text: requireEditText(entry.text, MAX_EDIT_TEXT_LENGTH),
      };
    }),
    redacted: requireBooleanValue(record.redacted),
    truncated: requireBooleanValue(record.truncated),
  };
}

export function decodeClaudeEditPreview(
  value: unknown,
  request: ClaudeEditRequest,
): ClaudeEditPreview {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_EDIT_PREVIEW_KEYS);
  const keyPath = requireText(record.keyPath, MAX_EDIT_KEY_LENGTH);
  const action = requireOneOf(CLAUDE_EDIT_ACTIONS, record.action);
  if (keyPath !== request.keyPath || action !== request.action)
    throw decodeFailure();
  if (!Array.isArray(record.effects) || record.effects.length > 16)
    throw decodeFailure();
  return {
    operationId: requireText(record.operationId, 128),
    summary: requireEditText(record.summary, MAX_EDIT_TEXT_LENGTH),
    effects: record.effects.map((effect) =>
      requireEditText(effect, MAX_EDIT_TEXT_LENGTH),
    ),
    expiresAt: requireText(record.expiresAt, 64),
    keyPath,
    action,
    kind: requireOneOf(CLAUDE_WRITE_KINDS, record.kind),
    recoveryPoint: requireOneOf(CLAUDE_RECOVERY_POINTS, record.recoveryPoint),
    diff: decodeClaudeEditDiff(record.diff),
    reloadNote: requireText(record.reloadNote, MAX_CLAUDE_TEXT_LENGTH),
  };
}

function decodeClaudeEditOutcome(value: unknown): ClaudeEditOutcome {
  const record = requireRecord(value);
  requireExactKeysWithOptional(
    record,
    CLAUDE_EDIT_OUTCOME_REQUIRED_KEYS,
    CLAUDE_EDIT_OUTCOME_OPTIONAL_KEYS,
  );
  return {
    kind: requireOneOf(CLAUDE_WRITE_KINDS, record.kind),
    status: requireOneOf(CLAUDE_OUTCOME_STATUSES, record.status),
    fileState: requireOneOf(CLAUDE_FILE_STATES, record.fileState),
    recoveryPoint: requireOneOf(CLAUDE_RECOVERY_POINTS, record.recoveryPoint),
    backupId:
      record.backupId === undefined ? null : requireText(record.backupId, 128),
    summary: requireEditText(record.summary, MAX_EDIT_TEXT_LENGTH),
    error: record.error === undefined ? null : decodeAppError(record.error),
  };
}

export function decodeClaudeEditResult(
  value: unknown,
  operationId: string,
): ClaudeEditResult {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_EDIT_RESULT_KEYS);
  if (requireText(record.operationId, 128) !== operationId)
    throw decodeFailure();
  return {
    operationId,
    outcome: decodeClaudeEditOutcome(record.outcome),
    reloadNote: requireText(record.reloadNote, MAX_CLAUDE_TEXT_LENGTH),
  };
}

export function getClaudeEditCatalog(): Promise<ClaudeEditCatalog> {
  return invokeCommand(
    "ai_config_claude_edit_catalog",
    decodeClaudeEditCatalog,
  );
}

function editInput(request: ClaudeEditRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    grantId: request.grantId,
    keyPath: request.keyPath,
    action: request.action,
  };
  if (request.action === "set") input.value = request.value;
  return input;
}

export function previewClaudeEdit(
  request: ClaudeEditRequest,
): Promise<ClaudeEditPreview> {
  return invokeCommand(
    "ai_config_claude_preview_edit",
    (value) => decodeClaudeEditPreview(value, request),
    { input: editInput(request) },
  );
}

export function confirmClaudeEdit(input: {
  readonly operationId: string;
  readonly grantId: string;
}): Promise<ClaudeEditResult> {
  return invokeCommand(
    "ai_config_claude_confirm_edit",
    (value) => decodeClaudeEditResult(value, input.operationId),
    { input: { operationId: input.operationId, grantId: input.grantId } },
  );
}

// Claude Code flags and environment command builder. Mirrors ai_config/command.rs:
// the request carries item ids and typed values only, and the response is text to
// copy. Nothing is executed and no secret value is ever sent or returned.

export const CLAUDE_OPTION_KINDS = ["flag", "env"] as const;
export type ClaudeOptionKind = (typeof CLAUDE_OPTION_KINDS)[number];

export const CLAUDE_OPTION_VALUE_TYPES = [
  "string",
  "boolean",
  "number",
  "stringArray",
  "object",
  "enum",
  "unknown",
] as const;
export type ClaudeOptionValueType = (typeof CLAUDE_OPTION_VALUE_TYPES)[number];

export const CLAUDE_OPTION_RISKS = [
  "executesCommand",
  "relaxesPermissions",
  "externalServer",
] as const;
export type ClaudeOptionRisk = (typeof CLAUDE_OPTION_RISKS)[number];

export const CLAUDE_VERSION_STATUSES = [
  "compatible",
  "unconfirmed",
  "incompatible",
  "notStated",
] as const;
export type ClaudeVersionStatus = (typeof CLAUDE_VERSION_STATUSES)[number];

export interface ClaudeVersionRange {
  readonly min: string;
  readonly max: string;
}

export interface ClaudeOptionItem {
  readonly id: string;
  readonly kind: ClaudeOptionKind;
  readonly valueType: ClaudeOptionValueType;
  readonly allowedValues: readonly string[];
  readonly description: string;
  readonly generatable: boolean;
  readonly secret: boolean;
  readonly singleInvocation: boolean | null;
  readonly excludes: readonly string[];
  readonly requires: readonly string[];
  readonly risks: readonly ClaudeOptionRisk[];
  readonly versions: ClaudeVersionRange | null;
  readonly configAlternative: string | null;
}

export interface ClaudeListingCoverage {
  readonly listedCount: number;
  readonly snapshotComplete: boolean;
  readonly coverageNote: string | null;
  readonly sourceUrl: string;
  readonly retrievedOn: string;
}

export interface ClaudeOptionSummary {
  readonly items: readonly ClaudeOptionItem[];
  readonly coverageNote: string;
  /** null 表示服务端未给出收录范围，界面按部分收录处理。 */
  readonly flagsCoverage: ClaudeListingCoverage | null;
  readonly envCoverage: ClaudeListingCoverage | null;
}

export interface ClaudeCommandItemChoice {
  readonly id: string;
  readonly value: string | null;
}

export interface ClaudeCommandRequest {
  readonly flags: readonly ClaudeCommandItemChoice[];
  readonly env: readonly ClaudeCommandItemChoice[];
  readonly acknowledgedRisks: readonly string[];
  readonly detectedVersion: string | null;
}

export interface ClaudeCommandNotice {
  readonly id: string;
  readonly status: ClaudeVersionStatus;
  readonly message: string;
}

export interface ClaudeBuiltCommand {
  readonly text: string;
  readonly notices: readonly ClaudeCommandNotice[];
  readonly placeholders: readonly string[];
}

const CLAUDE_OPTION_ITEM_KEYS = [
  "id",
  "kind",
  "valueType",
  "allowedValues",
  "description",
  "generatable",
  "secret",
  "singleInvocation",
  "excludes",
  "requires",
  "risks",
  "versions",
  "configAlternative",
] as const;
const CLAUDE_OPTION_SUMMARY_KEYS = ["items", "coverageNote"] as const;
const CLAUDE_OPTION_SUMMARY_OPTIONAL_KEYS = ["flagsCoverage", "envCoverage"] as const;
const CLAUDE_LISTING_COVERAGE_KEYS = [
  "listedCount",
  "snapshotComplete",
  "coverageNote",
  "sourceUrl",
  "retrievedOn",
] as const;
const CLAUDE_VERSION_RANGE_KEYS = ["min", "max"] as const;
const CLAUDE_COMMAND_NOTICE_KEYS = ["id", "status", "message"] as const;
const CLAUDE_BUILT_COMMAND_KEYS = ["text", "notices", "placeholders"] as const;
const MAX_CLAUDE_OPTION_ITEMS = 500;
const MAX_CLAUDE_ITEM_LIST = 64;
const MAX_CLAUDE_ITEM_ID_LENGTH = 128;
const MAX_CLAUDE_COMMAND_TEXT_LENGTH = 16_384;

function requireStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw decodeFailure();
  return value.map((item) => requireText(item, maxLength));
}

function decodeRisks(value: unknown): ClaudeOptionRisk[] {
  if (!Array.isArray(value) || value.length > CLAUDE_OPTION_RISKS.length) {
    throw decodeFailure();
  }
  return value.map((risk) => requireOneOf(CLAUDE_OPTION_RISKS, risk));
}

function decodeVersionRange(value: unknown): ClaudeVersionRange | null {
  if (value === null) return null;
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_VERSION_RANGE_KEYS);
  return {
    min: requireText(record.min, MAX_CLAUDE_ITEM_ID_LENGTH),
    max: requireText(record.max, MAX_CLAUDE_ITEM_ID_LENGTH),
  };
}

function decodeOptionItem(value: unknown): ClaudeOptionItem {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_OPTION_ITEM_KEYS);
  const kind = requireOneOf(CLAUDE_OPTION_KINDS, record.kind);
  const valueType = requireOneOf(CLAUDE_OPTION_VALUE_TYPES, record.valueType);
  const generatable = requireBoolean(record.generatable);
  const secret = requireBoolean(record.secret);
  if (generatable !== (valueType !== "unknown")) throw decodeFailure();
  if (secret && kind !== "env") throw decodeFailure();
  const allowedValues = requireStringList(
    record.allowedValues,
    MAX_CLAUDE_ITEM_LIST,
    MAX_CLAUDE_ITEM_ID_LENGTH,
  );
  if ((valueType === "enum") !== (allowedValues.length > 0)) throw decodeFailure();
  let singleInvocation: boolean | null = null;
  if (kind === "flag") {
    singleInvocation = requireBoolean(record.singleInvocation);
  } else if (record.singleInvocation !== null) {
    throw decodeFailure();
  }
  return {
    id: requireText(record.id, MAX_CLAUDE_ITEM_ID_LENGTH),
    kind,
    valueType,
    allowedValues,
    description: requireText(record.description, MAX_CLAUDE_TEXT_LENGTH),
    generatable,
    secret,
    singleInvocation,
    excludes: requireStringList(record.excludes, MAX_CLAUDE_ITEM_LIST, MAX_CLAUDE_ITEM_ID_LENGTH),
    requires: requireStringList(record.requires, MAX_CLAUDE_ITEM_LIST, MAX_CLAUDE_ITEM_ID_LENGTH),
    risks: decodeRisks(record.risks),
    versions: decodeVersionRange(record.versions),
    configAlternative: nullableText(record.configAlternative, MAX_CLAUDE_TEXT_LENGTH),
  };
}

function decodeListingCoverage(value: unknown, listedItems: number): ClaudeListingCoverage {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_LISTING_COVERAGE_KEYS);
  const listedCount = record.listedCount;
  if (typeof listedCount !== "number" || listedCount !== listedItems) throw decodeFailure();
  const snapshotComplete = requireBoolean(record.snapshotComplete);
  const coverageNote = nullableText(record.coverageNote, MAX_CLAUDE_TEXT_LENGTH);
  if (!snapshotComplete && coverageNote === null) throw decodeFailure();
  const sourceUrl = requireText(record.sourceUrl, MAX_CLAUDE_TEXT_LENGTH);
  if (!sourceUrl.startsWith("https://")) throw decodeFailure();
  const retrievedOn = requireText(record.retrievedOn, MAX_CLAUDE_ITEM_ID_LENGTH);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn)) throw decodeFailure();
  return { listedCount, snapshotComplete, coverageNote, sourceUrl, retrievedOn };
}

function decodeOptionalListing(
  record: Record<string, unknown>,
  key: "flagsCoverage" | "envCoverage",
  items: readonly ClaudeOptionItem[],
  kind: "flag" | "env",
): ClaudeListingCoverage | null {
  if (!(key in record)) return null;
  return decodeListingCoverage(record[key], items.filter((item) => item.kind === kind).length);
}

export function decodeClaudeOptionSummary(value: unknown): ClaudeOptionSummary {
  const record = requireRecord(value);
  requireExactKeysWithOptional(
    record,
    CLAUDE_OPTION_SUMMARY_KEYS,
    CLAUDE_OPTION_SUMMARY_OPTIONAL_KEYS,
  );
  if (!Array.isArray(record.items) || record.items.length > MAX_CLAUDE_OPTION_ITEMS) {
    throw decodeFailure();
  }
  const items = record.items.map(decodeOptionItem);
  return {
    items,
    coverageNote: requireText(record.coverageNote, MAX_CLAUDE_TEXT_LENGTH),
    flagsCoverage: decodeOptionalListing(record, "flagsCoverage", items, "flag"),
    envCoverage: decodeOptionalListing(record, "envCoverage", items, "env"),
  };
}

function decodeCommandNotice(value: unknown): ClaudeCommandNotice {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_COMMAND_NOTICE_KEYS);
  return {
    id: requireText(record.id, MAX_CLAUDE_ITEM_ID_LENGTH),
    status: requireOneOf(CLAUDE_VERSION_STATUSES, record.status),
    message: requireText(record.message, MAX_CLAUDE_TEXT_LENGTH),
  };
}

export function decodeClaudeBuiltCommand(value: unknown): ClaudeBuiltCommand {
  const record = requireRecord(value);
  requireExactKeys(record, CLAUDE_BUILT_COMMAND_KEYS);
  if (!Array.isArray(record.notices) || record.notices.length > MAX_CLAUDE_ITEM_LIST * 2) {
    throw decodeFailure();
  }
  return {
    text: requireText(record.text, MAX_CLAUDE_COMMAND_TEXT_LENGTH),
    notices: record.notices.map(decodeCommandNotice),
    placeholders: requireStringList(record.placeholders, MAX_CLAUDE_ITEM_LIST, MAX_CLAUDE_ITEM_ID_LENGTH),
  };
}

export function getClaudeOptions(): Promise<ClaudeOptionSummary> {
  return invokeCommand("ai_config_claude_flags", decodeClaudeOptionSummary);
}

export function buildClaudeCommand(request: ClaudeCommandRequest): Promise<ClaudeBuiltCommand> {
  return invokeCommand("ai_config_claude_build_command", decodeClaudeBuiltCommand, {
    request,
  });
}

/** 成功时后端不返回任何内容，任何其他载荷都视为协议错误。 */
export function decodeClaudeTerminalOpened(value: unknown): void {
  if (value !== null) throw decodeFailure();
}

/**
 * Asks the backend to open the command in Terminal. Only the structured choices are
 * sent; the backend rebuilds the command itself and never runs it.
 */
export function openClaudeCommandInTerminal(request: ClaudeCommandRequest): Promise<void> {
  return invokeCommand("ai_config_claude_open_in_terminal", decodeClaudeTerminalOpened, {
    input: { toolId: "claude-code", request, projectGrantId: null },
  });
}
