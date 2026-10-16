import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";
import { isGrantId } from "./grants";
import {
  decodeResourceWriteExecution,
  decodeResourceWritePreview,
  type ResourceWriteExecution,
  type ResourceWritePreview,
} from "./resources";

// Environment files are addressed by an authorization id plus a path relative
// to it; the frontend never sends or receives an absolute path. Secret values
// are not part of any list payload: they arrive only from the explicit
// `revealEnvironmentValue` call. Saving goes through preview → confirm; new
// values only travel to the backend, and a preview never carries the text of a
// secret value.

export const DEFAULT_ENV_PATTERNS: readonly string[] = [
  ".env",
  ".env.*",
  "*.env",
];

export type EnvFileKind = "ENVIRONMENT" | "TEMPLATE";
export type SkipReason =
  | "OUTSIDE_LINK"
  | "PROTECTED"
  | "UNREADABLE"
  | "BROKEN_LINK"
  | "INVALID_NAME"
  | "NOT_REGULAR";
export type PartialReason =
  | "ENTRY_LIMIT"
  | "MATCH_LIMIT"
  | "DEPTH_LIMIT"
  | "UNREADABLE_DIRECTORY";
export type FailureKind =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "MALFORMED"
  | "TOO_LARGE"
  | "UNSUPPORTED"
  | "EXCLUDED"
  | "IO";
export type EntryFlag =
  | "DUPLICATE_KEY"
  | "INTERPOLATION"
  | "COMMAND_SUBSTITUTION"
  | "MULTILINE_VALUE";
export type QuoteStyle = "NONE" | "SINGLE" | "DOUBLE";

export interface ScanSettings {
  readonly patterns: readonly string[];
  readonly recursive: boolean;
}

export interface ScannedFile {
  readonly relativePath: string;
  readonly name: string;
  readonly kind: EnvFileKind;
  readonly sizeBytes: number;
  readonly oversized: boolean;
  readonly symlink: boolean;
}

export interface SkippedEntry {
  readonly relativePath?: string;
  readonly reason: SkipReason;
}

export interface ScanLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxMatches: number;
  readonly maxFileBytes: number;
}

export interface ScanOutcome {
  readonly root: string;
  readonly recursive: boolean;
  readonly patterns: readonly string[];
  readonly files: readonly ScannedFile[];
  readonly skipped: readonly SkippedEntry[];
  readonly skippedTotal: number;
  readonly excludedDirectories: number;
  readonly partialReasons: readonly PartialReason[];
  readonly entriesExamined: number;
  readonly limits: ScanLimits;
  readonly exclusions: readonly string[];
}

interface EnvTextRow {
  readonly line: number;
  /** Absent when the text looked like a secret assignment and was withheld. */
  readonly text?: string;
  readonly withheld: boolean;
}

export type EnvRow =
  | { readonly kind: "BLANK"; readonly line: number }
  | ({ readonly kind: "COMMENT" } & EnvTextRow)
  | ({ readonly kind: "UNKNOWN" } & EnvTextRow)
  | {
      readonly kind: "ENTRY";
      readonly line: number;
      readonly endLine: number;
      readonly key: string;
      readonly exported: boolean;
      readonly secret: boolean;
      readonly hasValue: boolean;
      readonly valueLength: number;
      /** Absent for secrets and for very long values; fetch on demand. */
      readonly value?: string;
      readonly quote: QuoteStyle;
      readonly flags: readonly EntryFlag[];
    };

export interface EnvFileView {
  readonly relativePath: string;
  readonly kind: EnvFileKind;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly lineCount: number;
  readonly rows: readonly EnvRow[];
  readonly rowsTruncated: boolean;
  readonly entryCount: number;
  readonly secretCount: number;
  readonly flaggedCount: number;
}

export type EnvFileOutcome =
  | { readonly status: "READY"; readonly file: EnvFileView }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: FailureKind;
      readonly message: string;
    };

const ENV_FILE_KINDS: readonly string[] = ["ENVIRONMENT", "TEMPLATE"];
const SKIP_REASONS: readonly string[] = [
  "OUTSIDE_LINK",
  "PROTECTED",
  "UNREADABLE",
  "BROKEN_LINK",
  "INVALID_NAME",
  "NOT_REGULAR",
];
const PARTIAL_REASONS: readonly string[] = [
  "ENTRY_LIMIT",
  "MATCH_LIMIT",
  "DEPTH_LIMIT",
  "UNREADABLE_DIRECTORY",
];
const FAILURE_KINDS: readonly string[] = [
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "MALFORMED",
  "TOO_LARGE",
  "UNSUPPORTED",
  "EXCLUDED",
  "IO",
];
const ENTRY_FLAGS: readonly string[] = [
  "DUPLICATE_KEY",
  "INTERPOLATION",
  "COMMAND_SUBSTITUTION",
  "MULTILINE_VALUE",
];
const QUOTE_STYLES: readonly string[] = ["NONE", "SINGLE", "DOUBLE"];

// Bounds mirror the backend contract; a payload beyond them is malformed.
const MAX_PATH_LENGTH = 1024;
const MAX_NAME_LENGTH = 255;
const MAX_FILES = 200;
const MAX_SKIPPED = 100;
const MAX_ROWS = 5000;
const MAX_PATTERNS = 16;
const MAX_PATTERN_LENGTH = 128;
const MAX_INLINE_CHARS = 4096;
const MAX_VALUE_CHARS = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 512;
const MAX_EXCLUSIONS = 64;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function fail(): never {
  throw createInternalError();
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail();
  }
  return value;
}

function flag(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[]): T {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T)
    : fail();
}

function boundedText(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    hasControlCharacters(value)
  ) {
    return fail();
  }
  return value;
}

/** A path relative to the authorization: no absolute, `.`/`..` or empty segment. */
export function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !hasControlCharacters(value) &&
    value
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function relativePath(value: unknown): string {
  return typeof value === "string" && isSafeRelativePath(value) ? value : fail();
}

function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail();
}

function uniqueEnums<T extends string>(
  value: unknown,
  allowed: readonly string[],
  max: number,
): T[] {
  const items = list(value, max).map((item) => oneOf<T>(item, allowed));
  return new Set(items).size === items.length ? items : fail();
}

function decodeScannedFile(value: unknown): ScannedFile {
  if (!isRecord(value)) return fail();
  const path = relativePath(value.relativePath);
  const name = boundedText(value.name, MAX_NAME_LENGTH);
  if (name.includes("/") || path.split("/").pop() !== name) return fail();
  return {
    relativePath: path,
    name,
    kind: oneOf<EnvFileKind>(value.kind, ENV_FILE_KINDS),
    sizeBytes: count(value.sizeBytes),
    oversized: flag(value.oversized),
    symlink: flag(value.symlink),
  };
}

function decodeSkipped(value: unknown): SkippedEntry {
  if (!isRecord(value)) return fail();
  const reason = oneOf<SkipReason>(value.reason, SKIP_REASONS);
  if (value.relativePath === null || value.relativePath === undefined) {
    return { reason };
  }
  return { relativePath: relativePath(value.relativePath), reason };
}

function decodeLimits(value: unknown): ScanLimits {
  if (!isRecord(value)) return fail();
  return {
    maxDepth: count(value.maxDepth),
    maxEntries: count(value.maxEntries),
    maxMatches: count(value.maxMatches),
    maxFileBytes: count(value.maxFileBytes),
  };
}

export function decodeScanOutcome(value: unknown): ScanOutcome {
  if (!isRecord(value)) return fail();
  return {
    root: boundedText(value.root, MAX_PATH_LENGTH),
    recursive: flag(value.recursive),
    patterns: list(value.patterns, MAX_PATTERNS).map((pattern) =>
      boundedText(pattern, MAX_PATTERN_LENGTH),
    ),
    files: list(value.files, MAX_FILES).map(decodeScannedFile),
    skipped: list(value.skipped, MAX_SKIPPED).map(decodeSkipped),
    skippedTotal: count(value.skippedTotal),
    excludedDirectories: count(value.excludedDirectories),
    partialReasons: uniqueEnums<PartialReason>(
      value.partialReasons,
      PARTIAL_REASONS,
      PARTIAL_REASONS.length,
    ),
    entriesExamined: count(value.entriesExamined),
    limits: decodeLimits(value.limits),
    exclusions: list(value.exclusions, MAX_EXCLUSIONS).map((name) =>
      boundedText(name, MAX_NAME_LENGTH),
    ),
  };
}

// File text may hold any character (tabs, stray control characters); it is only
// ever rendered as text, so only its type and length are checked.
function optionalText(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" && value.length <= max + 1
    ? value
    : fail();
}

function decodeRow(value: unknown): EnvRow {
  if (!isRecord(value)) return fail();
  const line = count(value.line);
  if (line < 1) return fail();
  switch (value.kind) {
    case "BLANK":
      return { kind: "BLANK", line };
    case "COMMENT":
    case "UNKNOWN": {
      const text = optionalText(value.text, MAX_INLINE_CHARS);
      const withheld = flag(value.withheld);
      if (withheld !== (text === undefined)) return fail();
      const row: EnvTextRow = {
        line,
        ...(text === undefined ? {} : { text }),
        withheld,
      };
      return { kind: value.kind, ...row };
    }
    case "ENTRY": {
      const endLine = count(value.endLine);
      const key = typeof value.key === "string" && KEY_PATTERN.test(value.key)
        ? value.key
        : fail();
      const secret = flag(value.secret);
      const hasValue = flag(value.hasValue);
      const valueLength = count(value.valueLength);
      const text = optionalText(value.value, MAX_INLINE_CHARS);
      // A secret never arrives with its value, and a present value must match
      // the reported length.
      if (
        endLine < line ||
        hasValue !== valueLength > 0 ||
        (secret && text !== undefined) ||
        // `valueLength` counts characters, `String.length` UTF-16 units.
        (text !== undefined && [...text].length !== valueLength)
      ) {
        return fail();
      }
      return {
        kind: "ENTRY",
        line,
        endLine,
        key,
        exported: flag(value.exported),
        secret,
        hasValue,
        valueLength,
        ...(text === undefined ? {} : { value: text }),
        quote: oneOf<QuoteStyle>(value.quote, QUOTE_STYLES),
        flags: uniqueEnums<EntryFlag>(value.flags, ENTRY_FLAGS, ENTRY_FLAGS.length),
      };
    }
    default:
      return fail();
  }
}

function decodeFileView(value: unknown): EnvFileView {
  if (!isRecord(value)) return fail();
  return {
    relativePath: relativePath(value.relativePath),
    kind: oneOf<EnvFileKind>(value.kind, ENV_FILE_KINDS),
    contentHash:
      typeof value.contentHash === "string" && HASH_PATTERN.test(value.contentHash)
        ? value.contentHash
        : fail(),
    sizeBytes: count(value.sizeBytes),
    lineCount: count(value.lineCount),
    rows: list(value.rows, MAX_ROWS).map(decodeRow),
    rowsTruncated: flag(value.rowsTruncated),
    entryCount: count(value.entryCount),
    secretCount: count(value.secretCount),
    flaggedCount: count(value.flaggedCount),
  };
}

export function decodeEnvFileOutcome(value: unknown): EnvFileOutcome {
  if (!isRecord(value)) return fail();
  if (value.status === "UNAVAILABLE") {
    return {
      status: "UNAVAILABLE",
      reason: oneOf<FailureKind>(value.reason, FAILURE_KINDS),
      message: boundedText(value.message, MAX_MESSAGE_LENGTH),
    };
  }
  if (value.status === "READY") {
    return { status: "READY", file: decodeFileView(value) };
  }
  return fail();
}

export function decodeRevealedValue(value: unknown): string {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.value !== "string" ||
    value.value.length > MAX_VALUE_CHARS
  ) {
    return fail();
  }
  return value.value;
}

function invalidInput(message: string) {
  return Promise.reject({
    code: "INVALID_INPUT",
    message,
    retryable: false,
  });
}

function wireSettings(settings: ScanSettings) {
  return { patterns: [...settings.patterns], recursive: settings.recursive };
}

export function scanEnvironmentFiles(
  grantId: string,
  settings: ScanSettings,
): Promise<ScanOutcome> {
  if (!isGrantId(grantId)) return invalidInput("Authorization id is invalid.");
  return invokeCommand("scan_environment_files", decodeScanOutcome, {
    input: { grantId, ...wireSettings(settings) },
  });
}

export function readEnvironmentFile(
  grantId: string,
  path: string,
  settings: ScanSettings,
): Promise<EnvFileOutcome> {
  if (!isGrantId(grantId)) return invalidInput("Authorization id is invalid.");
  if (!isSafeRelativePath(path)) return invalidInput("File path is invalid.");
  return invokeCommand("read_environment_file", decodeEnvFileOutcome, {
    input: { grantId, relativePath: path, ...wireSettings(settings) },
  });
}

/** Fetches one value on explicit request; the result must not be stored. */
export function revealEnvironmentValue(
  grantId: string,
  path: string,
  settings: ScanSettings,
  target: { readonly line: number; readonly key: string },
): Promise<string> {
  if (!isGrantId(grantId)) return invalidInput("Authorization id is invalid.");
  if (!isSafeRelativePath(path)) return invalidInput("File path is invalid.");
  if (
    !Number.isSafeInteger(target.line) ||
    target.line < 1 ||
    !KEY_PATTERN.test(target.key)
  ) {
    return invalidInput("Entry reference is invalid.");
  }
  return invokeCommand("reveal_environment_value", decodeRevealedValue, {
    input: {
      grantId,
      relativePath: path,
      ...wireSettings(settings),
      line: target.line,
      key: target.key,
    },
  });
}

// ---- saving edits ------------------------------------------------------------

export type EnvKeyEdit =
  | {
      readonly op: "ADD";
      readonly key: string;
      readonly value: string;
      readonly exported?: boolean;
    }
  | { readonly op: "SET"; readonly key: string; readonly value: string }
  | { readonly op: "REMOVE"; readonly key: string };

export type EnvChangeKind = "ADD" | "MODIFY" | "REMOVE";

/** One key-level change. Secret entries never carry any value text. */
export interface EnvChange {
  readonly key: string;
  readonly change: EnvChangeKind;
  readonly secret: boolean;
  readonly before?: string;
  readonly after?: string;
  /** A non-secret value was left out because it is too long to show. */
  readonly omitted: boolean;
}

export interface EnvEditPreview extends ResourceWritePreview {
  readonly changes: readonly EnvChange[];
  readonly fileKind: EnvFileKind;
  /** Whether the default scan patterns would list the file's name. */
  readonly matchesDefaultPatterns: boolean;
}

const CHANGE_KINDS: readonly string[] = ["ADD", "MODIFY", "REMOVE"];
export const MAX_EDITS = 64;
/** Characters, as counted by the backend (`char`), not UTF-16 units. */
export const MAX_EDIT_VALUE_CHARS = 8192;

function decodeChange(value: unknown): EnvChange {
  if (!isRecord(value)) return fail();
  const key =
    typeof value.key === "string" && KEY_PATTERN.test(value.key)
      ? value.key
      : fail();
  const change = oneOf<EnvChangeKind>(value.change, CHANGE_KINDS);
  const secret = flag(value.secret);
  const omitted = flag(value.omitted);
  const before = optionalText(value.before, MAX_INLINE_CHARS);
  const after = optionalText(value.after, MAX_INLINE_CHARS);
  const missing =
    change === "ADD"
      ? [after]
      : change === "REMOVE"
        ? [before]
        : [before, after];
  const unexpected =
    change === "ADD" ? before : change === "REMOVE" ? after : undefined;
  if (unexpected !== undefined) return fail();
  const absent = missing.filter((side) => side === undefined).length;
  // A secret never arrives with text; a value is only absent for a stated reason.
  if (secret) {
    if (absent !== missing.length || omitted) return fail();
  } else if (omitted !== absent > 0) {
    return fail();
  }
  return {
    key,
    change,
    secret,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    omitted,
  };
}

export function decodeEnvEditPreview(value: unknown): EnvEditPreview {
  const write = decodeResourceWritePreview(value);
  if (!isRecord(value)) return fail();
  // The raw text diff is always withheld; a response that carries one is not
  // trusted, because it could hold secret values.
  if (!write.diff.redacted || write.diff.lines.length > 0) return fail();
  const changes = list(value.changes, MAX_EDITS).map(decodeChange);
  if (
    changes.length === 0 ||
    new Set(changes.map((change) => change.key)).size !== changes.length
  ) {
    return fail();
  }
  return {
    ...write,
    changes,
    fileKind: oneOf<EnvFileKind>(value.fileKind, ENV_FILE_KINDS),
    matchesDefaultPatterns: flag(value.matchesDefaultPatterns),
  };
}

/** The reason a set of edits cannot be sent, or `undefined` when it can. */
export function editsProblem(edits: readonly EnvKeyEdit[]): string | undefined {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) {
    return "一次保存需要 1 到 64 项改动。";
  }
  const seen = new Set<string>();
  for (const edit of edits) {
    if (typeof edit.key !== "string" || !KEY_PATTERN.test(edit.key)) {
      return "键名必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 255 个字符。";
    }
    if (seen.has(edit.key)) return "同一个键在一次保存里只能改动一次。";
    seen.add(edit.key);
    if (edit.op === "REMOVE") {
      if ("value" in edit) return "删除不带值。";
    } else if (edit.op === "ADD" || edit.op === "SET") {
      if (
        typeof edit.value !== "string" ||
        [...edit.value].length > MAX_EDIT_VALUE_CHARS
      ) {
        return "值必须是不超过 8192 个字符的文本。";
      }
    } else {
      return "不支持的改动类型。";
    }
  }
  return undefined;
}

function wireEdit(edit: EnvKeyEdit): Record<string, unknown> {
  switch (edit.op) {
    case "ADD":
      return {
        op: "ADD",
        key: edit.key,
        value: edit.value,
        ...(edit.exported === true ? { exported: true } : {}),
      };
    case "SET":
      return { op: "SET", key: edit.key, value: edit.value };
    case "REMOVE":
      return { op: "REMOVE", key: edit.key };
  }
}

/**
 * Previews edits of an existing file. `expectedHash` is the hash of the
 * content the editor showed; a changed file is refused, never merged.
 */
export function previewEnvironmentEdit(
  grantId: string,
  path: string,
  settings: ScanSettings,
  expectedHash: string,
  edits: readonly EnvKeyEdit[],
): Promise<EnvEditPreview> {
  if (!isGrantId(grantId)) return invalidInput("Authorization id is invalid.");
  if (!isSafeRelativePath(path)) return invalidInput("File path is invalid.");
  if (!HASH_PATTERN.test(expectedHash)) {
    return invalidInput("The content hash is invalid.");
  }
  const problem = editsProblem(edits);
  if (problem !== undefined) return invalidInput(problem);
  return invokeCommand("preview_environment_edit", decodeEnvEditPreview, {
    input: {
      grantId,
      relativePath: path,
      ...wireSettings(settings),
      expectedHash,
      edits: edits.map(wireEdit),
    },
  });
}

/**
 * Previews a new file. `grantId` must come from the native save-location
 * panel (`selectSaveLocationGrant`); the frontend never names a path.
 */
export function previewEnvironmentCreate(
  grantId: string,
  edits: readonly EnvKeyEdit[],
): Promise<EnvEditPreview> {
  if (!isGrantId(grantId)) return invalidInput("Authorization id is invalid.");
  const problem = editsProblem(edits);
  if (problem !== undefined) return invalidInput(problem);
  return invokeCommand("preview_environment_create", decodeEnvEditPreview, {
    input: { grantId, edits: edits.map(wireEdit) },
  });
}

/**
 * Confirms a previewed edit. A rejection means nothing was changed; a
 * resolved value means the transaction ran, so read `outcome.status` and
 * `outcome.fileState` for what the file really contains.
 */
export function executeEnvironmentEdit(input: {
  readonly operationId: string;
  readonly grantId: string;
  /** Omit for a new file (a save-location authorization). */
  readonly relativePath?: string;
}): Promise<ResourceWriteExecution> {
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    return invalidInput("Operation id is invalid.");
  }
  if (!isGrantId(input.grantId)) return invalidInput("Authorization id is invalid.");
  if (input.relativePath !== undefined && !isSafeRelativePath(input.relativePath)) {
    return invalidInput("File path is invalid.");
  }
  return invokeCommand("execute_environment_edit", decodeResourceWriteExecution, {
    input: {
      operationId: input.operationId,
      grantId: input.grantId,
      ...(input.relativePath === undefined ? {} : { relativePath: input.relativePath }),
    },
  });
}

// ---- zsh startup files (read-only) ------------------------------------------
//
// The four startup files are built-in sources: the frontend never sends or
// receives an absolute path for them. The only input is the optional directory
// authorization the user chose for a `ZDOTDIR` that cannot be determined
// statically. Secret values are not part of the list; they come from
// `revealZshValue` only.

export type ZshFileKey = "ZSHENV" | "ZPROFILE" | "ZSHRC" | "ZLOGIN";
export type ZshAppliesTo = "ALL" | "LOGIN" | "INTERACTIVE";
export type ZshStepScope = "SYSTEM" | "USER";
export type ZshValueState = "STATIC" | "REFERENCE" | "DYNAMIC";
export type ZshOperation = "SET" | "APPEND";
export type ZshDynamicReason =
  | "COMMAND_SUBSTITUTION"
  | "ARITHMETIC"
  | "UNRESOLVED_REFERENCE"
  | "CONDITIONAL"
  | "BLOCK"
  | "SOURCE"
  | "EVAL"
  | "FUNCTION_DEFINITION"
  | "ALIAS"
  | "COMPOUND"
  | "LINE_CONTINUATION"
  | "HERE_DOC"
  | "MULTILINE_QUOTE"
  | "EXPANSION";
export type ZshUndeterminedReason =
  | "DYNAMIC"
  | "MULTIPLE"
  | "UNSUPPORTED_FORM"
  | "ZSHENV_NOT_READ";

export interface ZshSource {
  readonly url: string;
  /** `YYYY-MM-DD`. */
  readonly consultedOn: string;
}

export interface ZshOrderStep {
  readonly position: number;
  readonly scope: ZshStepScope;
  readonly pathLabel: string;
  readonly appliesTo: ZshAppliesTo;
  /** The user file of this step; absent for system-level steps. */
  readonly file?: ZshFileKey;
  /** System-level files are only listed, never read. */
  readonly readByUserHome: boolean;
}

export type ZshZdotdir =
  | { readonly status: "DEFAULT" }
  | { readonly status: "STATIC"; readonly displayPath: string; readonly line: number }
  | { readonly status: "OUTSIDE"; readonly displayPath: string; readonly line: number }
  | { readonly status: "SELECTED"; readonly displayPath: string }
  | {
      readonly status: "UNDETERMINED";
      readonly reason: ZshUndeterminedReason;
      /** Why the directory the user chose could not be used. */
      readonly selectionProblem?: string;
    };

export interface ZshPathSegment {
  readonly text: string;
  readonly state: ZshValueState;
}

export interface ZshEntryRow {
  readonly kind: "ENTRY";
  readonly line: number;
  readonly endLine: number;
  readonly name: string;
  readonly exported: boolean;
  readonly operation: ZshOperation;
  readonly secret: boolean;
  readonly hasValue: boolean;
  readonly valueLength: number;
  /** Absent for secrets and for very long values; fetch on demand. */
  readonly value?: string;
  readonly state: ZshValueState;
  /** Present exactly when `state` is `DYNAMIC`. */
  readonly reason?: ZshDynamicReason;
  /** Items of a `PATH`/`path` entry, in written order. */
  readonly pathSegments?: readonly ZshPathSegment[];
}

export type ZshRow =
  | { readonly kind: "BLANK"; readonly line: number }
  | ({ readonly kind: "COMMENT" } & EnvTextRow)
  | ({
      readonly kind: "DYNAMIC";
      readonly endLine: number;
      readonly reason: ZshDynamicReason;
    } & EnvTextRow)
  | ({ readonly kind: "UNRECOGNIZED"; readonly endLine: number } & EnvTextRow)
  | ZshEntryRow;

export interface ZshFileDetail {
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly lineCount: number;
  readonly rows: readonly ZshRow[];
  readonly rowsTruncated: boolean;
  readonly entryCount: number;
  readonly secretCount: number;
  readonly dynamicCount: number;
  readonly unrecognizedCount: number;
}

export type ZshFileOutcome =
  | ({ readonly status: "READY" } & ZshFileDetail)
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: FailureKind;
      readonly message: string;
    }
  | { readonly status: "OUTSIDE_HOME"; readonly message: string }
  | { readonly status: "NOT_LOCATED"; readonly message: string };

export interface ZshFile {
  readonly file: ZshFileKey;
  readonly name: string;
  readonly appliesTo: ZshAppliesTo;
  /** Position of the file in the documented reading order. */
  readonly position: number;
  /** Absent while the location is unknown (`NOT_LOCATED`). */
  readonly displayPath?: string;
  readonly outcome: ZshFileOutcome;
}

export interface ZshOverview {
  readonly source: ZshSource;
  readonly order: readonly ZshOrderStep[];
  readonly zdotdir: ZshZdotdir;
  readonly files: readonly ZshFile[];
}

export const ZSH_FILE_KEYS: readonly ZshFileKey[] = [
  "ZSHENV",
  "ZPROFILE",
  "ZSHRC",
  "ZLOGIN",
];
const ZSH_FILE_NAMES: Readonly<Record<ZshFileKey, string>> = {
  ZSHENV: ".zshenv",
  ZPROFILE: ".zprofile",
  ZSHRC: ".zshrc",
  ZLOGIN: ".zlogin",
};
const ZSH_APPLIES_TO: readonly string[] = ["ALL", "LOGIN", "INTERACTIVE"];
const ZSH_SCOPES: readonly string[] = ["SYSTEM", "USER"];
const ZSH_VALUE_STATES: readonly string[] = ["STATIC", "REFERENCE", "DYNAMIC"];
const ZSH_OPERATIONS: readonly string[] = ["SET", "APPEND"];
const ZSH_REASONS: readonly string[] = [
  "COMMAND_SUBSTITUTION",
  "ARITHMETIC",
  "UNRESOLVED_REFERENCE",
  "CONDITIONAL",
  "BLOCK",
  "SOURCE",
  "EVAL",
  "FUNCTION_DEFINITION",
  "ALIAS",
  "COMPOUND",
  "LINE_CONTINUATION",
  "HERE_DOC",
  "MULTILINE_QUOTE",
  "EXPANSION",
];
const ZSH_UNDETERMINED_REASONS: readonly string[] = [
  "DYNAMIC",
  "MULTIPLE",
  "UNSUPPORTED_FORM",
  "ZSHENV_NOT_READ",
];
const ZSH_ORDER_STEPS = 8;
const MAX_ZSH_SEGMENTS = 512;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function nullable(value: unknown): unknown {
  return value === null ? undefined : value;
}

function decodeZshSource(value: unknown): ZshSource {
  if (!isRecord(value)) return fail();
  const url = boundedText(value.url, MAX_PATH_LENGTH);
  const consultedOn = boundedText(value.consultedOn, 10);
  if (!url.startsWith("https://") || !DATE_PATTERN.test(consultedOn)) {
    return fail();
  }
  return { url, consultedOn };
}

function decodeZshOrder(value: unknown): ZshOrderStep[] {
  const steps = list(value, ZSH_ORDER_STEPS).map((item): ZshOrderStep => {
    if (!isRecord(item)) return fail();
    const scope = oneOf<ZshStepScope>(item.scope, ZSH_SCOPES);
    const rawFile = nullable(item.file);
    const file =
      rawFile === undefined ? undefined : oneOf<ZshFileKey>(rawFile, ZSH_FILE_KEYS);
    const readByUserHome = flag(item.readByUserHome);
    // System-level steps stand for no user file and are never read.
    if ((scope === "SYSTEM") !== (file === undefined) || (scope === "USER") !== readByUserHome) {
      return fail();
    }
    return {
      position: count(item.position),
      scope,
      pathLabel: boundedText(item.pathLabel, MAX_NAME_LENGTH),
      appliesTo: oneOf<ZshAppliesTo>(item.appliesTo, ZSH_APPLIES_TO),
      ...(file === undefined ? {} : { file }),
      readByUserHome,
    };
  });
  const userFiles = steps.flatMap((step) => (step.file ? [step.file] : []));
  if (
    steps.length !== ZSH_ORDER_STEPS ||
    steps.some((step, index) => step.position !== index + 1) ||
    userFiles.join() !== ZSH_FILE_KEYS.join()
  ) {
    return fail();
  }
  return steps;
}

function decodeZshZdotdir(value: unknown): ZshZdotdir {
  if (!isRecord(value)) return fail();
  switch (value.status) {
    case "DEFAULT":
      return { status: "DEFAULT" };
    case "STATIC":
    case "OUTSIDE": {
      const line = count(value.line);
      if (line < 1) return fail();
      return {
        status: value.status,
        displayPath: boundedText(value.displayPath, MAX_PATH_LENGTH),
        line,
      };
    }
    case "SELECTED":
      return {
        status: "SELECTED",
        displayPath: boundedText(value.displayPath, MAX_PATH_LENGTH),
      };
    case "UNDETERMINED": {
      const problem = nullable(value.selectionProblem);
      return {
        status: "UNDETERMINED",
        reason: oneOf<ZshUndeterminedReason>(value.reason, ZSH_UNDETERMINED_REASONS),
        ...(problem === undefined
          ? {}
          : { selectionProblem: boundedText(problem, MAX_MESSAGE_LENGTH) }),
      };
    }
    default:
      return fail();
  }
}

function decodeZshSegment(value: unknown): ZshPathSegment {
  if (!isRecord(value)) return fail();
  const text = optionalText(value.text, MAX_INLINE_CHARS);
  if (text === undefined) return fail();
  return { text, state: oneOf<ZshValueState>(value.state, ZSH_VALUE_STATES) };
}

function decodeZshEntry(value: Record<string, unknown>, line: number): ZshEntryRow {
  const endLine = count(value.endLine);
  const name =
    typeof value.name === "string" && KEY_PATTERN.test(value.name)
      ? value.name
      : fail();
  const secret = flag(value.secret);
  const hasValue = flag(value.hasValue);
  const valueLength = count(value.valueLength);
  const text = optionalText(nullable(value.value), MAX_INLINE_CHARS);
  const state = oneOf<ZshValueState>(value.state, ZSH_VALUE_STATES);
  const rawReason = nullable(value.reason);
  const rawSegments = nullable(value.pathSegments);
  const segments =
    rawSegments === undefined
      ? undefined
      : list(rawSegments, MAX_ZSH_SEGMENTS).map(decodeZshSegment);
  // A secret never arrives with its value (or the path items that would carry
  // it), a present value matches the reported length, and a dynamic state
  // always says why.
  if (
    endLine < line ||
    hasValue !== valueLength > 0 ||
    (secret && (text !== undefined || segments !== undefined)) ||
    // `valueLength` counts characters, `String.length` UTF-16 units.
    (text !== undefined && [...text].length !== valueLength) ||
    (state === "DYNAMIC") !== (rawReason !== undefined)
  ) {
    return fail();
  }
  return {
    kind: "ENTRY",
    line,
    endLine,
    name,
    exported: flag(value.exported),
    operation: oneOf<ZshOperation>(value.operation, ZSH_OPERATIONS),
    secret,
    hasValue,
    valueLength,
    ...(text === undefined ? {} : { value: text }),
    state,
    ...(rawReason === undefined
      ? {}
      : { reason: oneOf<ZshDynamicReason>(rawReason, ZSH_REASONS) }),
    ...(segments === undefined ? {} : { pathSegments: segments }),
  };
}

function decodeZshRow(value: unknown): ZshRow {
  if (!isRecord(value)) return fail();
  const line = count(value.line);
  if (line < 1) return fail();
  switch (value.kind) {
    case "BLANK":
      return { kind: "BLANK", line };
    case "COMMENT": {
      const text = optionalText(nullable(value.text), MAX_INLINE_CHARS);
      const withheld = flag(value.withheld);
      if (withheld !== (text === undefined)) return fail();
      return { kind: "COMMENT", line, ...(text === undefined ? {} : { text }), withheld };
    }
    case "DYNAMIC":
    case "UNRECOGNIZED": {
      const endLine = count(value.endLine);
      const text = optionalText(nullable(value.text), MAX_INLINE_CHARS);
      const withheld = flag(value.withheld);
      if (endLine < line || withheld !== (text === undefined)) return fail();
      const common = { line, endLine, ...(text === undefined ? {} : { text }), withheld };
      return value.kind === "DYNAMIC"
        ? {
            kind: "DYNAMIC",
            ...common,
            reason: oneOf<ZshDynamicReason>(value.reason, ZSH_REASONS),
          }
        : { kind: "UNRECOGNIZED", ...common };
    }
    case "ENTRY":
      return decodeZshEntry(value, line);
    default:
      return fail();
  }
}

function decodeZshOutcome(value: unknown): ZshFileOutcome {
  if (!isRecord(value)) return fail();
  switch (value.status) {
    case "READY":
      return {
        status: "READY",
        contentHash:
          typeof value.contentHash === "string" && HASH_PATTERN.test(value.contentHash)
            ? value.contentHash
            : fail(),
        sizeBytes: count(value.sizeBytes),
        lineCount: count(value.lineCount),
        rows: list(value.rows, MAX_ROWS).map(decodeZshRow),
        rowsTruncated: flag(value.rowsTruncated),
        entryCount: count(value.entryCount),
        secretCount: count(value.secretCount),
        dynamicCount: count(value.dynamicCount),
        unrecognizedCount: count(value.unrecognizedCount),
      };
    case "UNAVAILABLE":
      return {
        status: "UNAVAILABLE",
        reason: oneOf<FailureKind>(value.reason, FAILURE_KINDS),
        message: boundedText(value.message, MAX_MESSAGE_LENGTH),
      };
    case "OUTSIDE_HOME":
    case "NOT_LOCATED":
      return {
        status: value.status,
        message: boundedText(value.message, MAX_MESSAGE_LENGTH),
      };
    default:
      return fail();
  }
}

function decodeZshFile(value: unknown): ZshFile {
  if (!isRecord(value)) return fail();
  const file = oneOf<ZshFileKey>(value.file, ZSH_FILE_KEYS);
  const appliesTo = oneOf<ZshAppliesTo>(value.appliesTo, ZSH_APPLIES_TO);
  const outcome = decodeZshOutcome(value.outcome);
  const rawPath = nullable(value.displayPath);
  const displayPath =
    rawPath === undefined ? undefined : boundedText(rawPath, MAX_PATH_LENGTH);
  // A file whose location is unknown has no path; every other outcome has one.
  if ((outcome.status === "NOT_LOCATED") !== (displayPath === undefined)) {
    return fail();
  }
  return {
    file,
    name: value.name === ZSH_FILE_NAMES[file] ? ZSH_FILE_NAMES[file] : fail(),
    appliesTo,
    position: count(value.position),
    ...(displayPath === undefined ? {} : { displayPath }),
    outcome,
  };
}

export function decodeZshOverview(value: unknown): ZshOverview {
  if (!isRecord(value)) return fail();
  const order = decodeZshOrder(value.order);
  const files = list(value.files, ZSH_FILE_KEYS.length).map(decodeZshFile);
  const seen = new Set<ZshFileKey>();
  for (const file of files) {
    const step = order.find((candidate) => candidate.file === file.file);
    // Position and shell type must agree with the documented order.
    if (
      seen.has(file.file) ||
      step === undefined ||
      step.position !== file.position ||
      step.appliesTo !== file.appliesTo
    ) {
      return fail();
    }
    seen.add(file.file);
  }
  return {
    source: decodeZshSource(value.source),
    order,
    zdotdir: decodeZshZdotdir(value.zdotdir),
    files,
  };
}

/**
 * Reads the four startup files. `zdotdirGrantId` is the directory
 * authorization the user chose for an undetermined `ZDOTDIR`; it is ignored by
 * the backend when `ZDOTDIR` can be determined statically.
 */
export function readZshStartupFiles(
  zdotdirGrantId?: string,
): Promise<ZshOverview> {
  if (zdotdirGrantId !== undefined && !isGrantId(zdotdirGrantId)) {
    return invalidInput("Authorization id is invalid.");
  }
  return invokeCommand("read_zsh_startup_files", decodeZshOverview, {
    input: zdotdirGrantId === undefined ? {} : { zdotdirGrantId },
  });
}

export interface ZshEntryReference {
  readonly file: ZshFileKey;
  readonly line: number;
  readonly name: string;
}

/** Fetches one entry's value on explicit request; the result must not be stored. */
export function revealZshValue(
  target: ZshEntryReference,
  zdotdirGrantId?: string,
): Promise<string> {
  if (zdotdirGrantId !== undefined && !isGrantId(zdotdirGrantId)) {
    return invalidInput("Authorization id is invalid.");
  }
  if (
    !ZSH_FILE_KEYS.includes(target.file) ||
    !Number.isSafeInteger(target.line) ||
    target.line < 1 ||
    typeof target.name !== "string" ||
    !KEY_PATTERN.test(target.name)
  ) {
    return invalidInput("Entry reference is invalid.");
  }
  return invokeCommand("reveal_zsh_value", decodeRevealedValue, {
    input: {
      file: target.file,
      line: target.line,
      name: target.name,
      ...(zdotdirGrantId === undefined ? {} : { zdotdirGrantId }),
    },
  });
}

// ---- zsh managed block (editing) ----------------------------------------------
//
// The four startup files stay built-in sources: no call here carries a path or
// an authorization id for the file. "Enable editing" makes the backend build
// the authorization from the fixed file name and the canonical home folder;
// preview and confirm name the file (and the optional ZDOTDIR directory the
// user chose) and nothing else. New values only travel to the backend; a
// preview and a state never carry the text of a secret value, and the raw text
// diff of the whole file is always withheld (the preview shows the managed
// lines only, masked).

export type ZshProblemKind =
  | "MISSING_END"
  | "MISSING_BEGIN"
  | "WRONG_ORDER"
  | "NESTED"
  | "DUPLICATE"
  | "UNMANAGED";

export interface ZshEditVariable {
  readonly name: string;
  readonly line: number;
  readonly secret: boolean;
  readonly hasValue: boolean;
  readonly valueLength: number;
  /** Absent for secrets and for very long values. */
  readonly value?: string;
}

export type ZshEditBlock =
  | { readonly status: "ABSENT" }
  | {
      readonly status: "PRESENT";
      readonly beginLine: number;
      readonly endLine: number;
      readonly variables: readonly ZshEditVariable[];
      /** Normalized items in written order (`$HOME/bin` stands for `~/bin`). */
      readonly path: readonly string[];
    }
  | {
      readonly status: "BROKEN";
      readonly kind: ZshProblemKind;
      readonly line: number;
      readonly message: string;
    };

export interface ZshOutsideVariable {
  readonly name: string;
  readonly line: number;
  /** Before the managed block (the block wins) or after it (this one wins). */
  readonly beforeBlock: boolean;
  readonly state: ZshValueState;
  readonly secret: boolean;
}

export interface ZshOutsidePath {
  readonly line: number;
  readonly beforeBlock: boolean;
  readonly operation: ZshOperation;
  readonly state: ZshValueState;
  readonly reason?: ZshDynamicReason;
  /** As the read-only parser sees them: never expanded, never rewritten. */
  readonly segments: readonly ZshPathSegment[];
}

export interface ZshOutsideDynamicLine {
  readonly line: number;
  readonly beforeBlock: boolean;
  readonly reason?: ZshDynamicReason;
  readonly text?: string;
  readonly withheld: boolean;
}

export interface ZshEditOutside {
  readonly variables: readonly ZshOutsideVariable[];
  readonly path: readonly ZshOutsidePath[];
  readonly dynamicPathLines: readonly ZshOutsideDynamicLine[];
  readonly truncated: boolean;
}

export interface ZshEditState {
  readonly file: ZshFileKey;
  readonly name: string;
  readonly appliesTo: ZshAppliesTo;
  readonly position: number;
  /** `~/.zshrc`-style path for display. */
  readonly displayPath: string;
  /** The absolute path of the file, as the backend located it. */
  readonly fullPath: string;
  readonly exists: boolean;
  /** Absent exactly when the file does not exist. */
  readonly contentHash?: string;
  /** Editing was enabled for this file (an authorization exists). */
  readonly enabled: boolean;
  /** The authorization, so it can be revoked with `revokeGrant`. */
  readonly grantId?: string;
  readonly block: ZshEditBlock;
  readonly outside: ZshEditOutside;
}

export type ZshEditOutcome =
  | ({ readonly status: "READY" } & ZshEditState)
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: FailureKind;
      readonly message: string;
    }
  | { readonly status: "OUTSIDE_HOME"; readonly message: string }
  | { readonly status: "NOT_LOCATED"; readonly message: string };

export interface ZshEditEnabled {
  readonly file: ZshFileKey;
  readonly displayPath: string;
  readonly fullPath: string;
  readonly exists: boolean;
  readonly grantId: string;
}

export interface ZshEditTarget {
  readonly file: ZshFileKey;
  /** The directory authorization the user chose for an undetermined `ZDOTDIR`. */
  readonly zdotdirGrantId?: string;
}

export type ZshVariableEdit =
  | { readonly op: "SET"; readonly name: string; readonly value: string }
  | { readonly op: "REMOVE"; readonly name: string };

export interface ZshBlockEdit {
  readonly variables: readonly ZshVariableEdit[];
  /** The complete managed PATH list; absent leaves PATH as it is. */
  readonly path?: readonly string[];
}

export interface ZshVariableChange {
  readonly name: string;
  readonly change: EnvChangeKind;
  readonly secret: boolean;
  readonly before?: string;
  readonly after?: string;
  /** A non-secret value was left out because it is too long to show. */
  readonly omitted: boolean;
}

export interface ZshPathChange {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface ZshBlockDiffLine {
  readonly kind: "ADDED" | "REMOVED";
  /** Managed lines only; secret values are already masked. */
  readonly text: string;
}

export type ZshEditWarning =
  | { readonly kind: "OVERRIDES_EARLIER_ASSIGNMENT"; readonly name: string; readonly line: number }
  | { readonly kind: "OVERRIDDEN_BY_LATER_ASSIGNMENT"; readonly name: string; readonly line: number }
  | { readonly kind: "DUPLICATE_PATH_ITEM"; readonly item: string }
  | { readonly kind: "PATH_ITEM_ALSO_OUTSIDE"; readonly item: string; readonly line: number }
  | { readonly kind: "DYNAMIC_PATH_OUTSIDE"; readonly line: number }
  | { readonly kind: "LATER_PATH_ASSIGNMENT"; readonly line: number }
  | { readonly kind: "BLOCK_APPENDED" }
  | { readonly kind: "FILE_CREATED" };

export interface ZshEditPreview extends ResourceWritePreview {
  readonly file: ZshFileKey;
  readonly appliesTo: ZshAppliesTo;
  readonly position: number;
  readonly displayPath: string;
  /** The complete path that will be written (where a symbolic link leads). */
  readonly fullPath: string;
  readonly createdBlock: boolean;
  readonly variableChanges: readonly ZshVariableChange[];
  readonly pathChange?: ZshPathChange;
  readonly blockDiff: readonly ZshBlockDiffLine[];
  readonly warnings: readonly ZshEditWarning[];
  readonly effectNote: string;
}

export interface ZshEditExecution extends ResourceWriteExecution {
  readonly file: ZshFileKey;
  readonly effectNote: string;
}

export const MAX_ZSH_VARIABLES = 128;
export const MAX_ZSH_PATH_ITEMS = 64;
const MAX_ZSH_OUTSIDE_ROWS = 500;
const MAX_ZSH_DIFF_LINES = 300;
const MAX_ZSH_WARNINGS = 1000;
const MAX_ZSH_DIFF_TEXT = 40000;
const ZSH_PROBLEM_KINDS: readonly string[] = [
  "MISSING_END",
  "MISSING_BEGIN",
  "WRONG_ORDER",
  "NESTED",
  "DUPLICATE",
  "UNMANAGED",
];
/** A stored PATH item: an absolute literal path or one starting with `$HOME`. */
const ZSH_PATH_ITEM_PATTERN = /^(\/|\$HOME(\/|$))/;
const ZSH_RESERVED_NAMES: readonly string[] = ["PATH", "path"];

function absolutePath(value: unknown): string {
  const text = boundedText(value, MAX_PATH_LENGTH);
  return text.startsWith("/") ? text : fail();
}

function displayPathText(value: unknown): string {
  const text = boundedText(value, MAX_PATH_LENGTH);
  return text.startsWith("~") || text.startsWith("/") ? text : fail();
}

function zshName(value: unknown): string {
  return typeof value === "string" && KEY_PATTERN.test(value) ? value : fail();
}

function decodeZshEditVariable(value: unknown): ZshEditVariable {
  if (!isRecord(value)) return fail();
  const line = count(value.line);
  const secret = flag(value.secret);
  const hasValue = flag(value.hasValue);
  const valueLength = count(value.valueLength);
  const text = optionalText(nullable(value.value), MAX_INLINE_CHARS);
  if (
    line < 1 ||
    hasValue !== valueLength > 0 ||
    (secret && text !== undefined) ||
    // `valueLength` counts characters, `String.length` UTF-16 units.
    (text !== undefined && [...text].length !== valueLength)
  ) {
    return fail();
  }
  return {
    name: zshName(value.name),
    line,
    secret,
    hasValue,
    valueLength,
    ...(text === undefined ? {} : { value: text }),
  };
}

function decodeZshEditBlock(value: unknown): ZshEditBlock {
  if (!isRecord(value)) return fail();
  switch (value.status) {
    case "ABSENT":
      return { status: "ABSENT" };
    case "PRESENT": {
      const beginLine = count(value.beginLine);
      const endLine = count(value.endLine);
      const variables = list(value.variables, MAX_ZSH_VARIABLES).map(
        decodeZshEditVariable,
      );
      const path = list(value.path, MAX_ZSH_PATH_ITEMS).map((item) => {
        const text = boundedText(item, MAX_PATH_LENGTH);
        return ZSH_PATH_ITEM_PATTERN.test(text) ? text : fail();
      });
      const names = variables.map((variable) => variable.name);
      if (
        beginLine < 1 ||
        endLine <= beginLine ||
        new Set(names).size !== names.length ||
        names.some((name) => ZSH_RESERVED_NAMES.includes(name)) ||
        variables.some(
          (variable) => variable.line <= beginLine || variable.line >= endLine,
        )
      ) {
        return fail();
      }
      return { status: "PRESENT", beginLine, endLine, variables, path };
    }
    case "BROKEN": {
      const line = count(value.line);
      if (line < 1) return fail();
      return {
        status: "BROKEN",
        kind: oneOf<ZshProblemKind>(value.kind, ZSH_PROBLEM_KINDS),
        line,
        message: boundedText(value.message, MAX_MESSAGE_LENGTH),
      };
    }
    default:
      return fail();
  }
}

function decodeZshOutside(value: unknown): ZshEditOutside {
  if (!isRecord(value)) return fail();
  const variables = list(value.variables, MAX_ZSH_OUTSIDE_ROWS).map((item) => {
    if (!isRecord(item)) return fail();
    const line = count(item.line);
    if (line < 1) return fail();
    return {
      name: zshName(item.name),
      line,
      beforeBlock: flag(item.beforeBlock),
      state: oneOf<ZshValueState>(item.state, ZSH_VALUE_STATES),
      secret: flag(item.secret),
    };
  });
  const path = list(value.path, MAX_ZSH_OUTSIDE_ROWS).map((item): ZshOutsidePath => {
    if (!isRecord(item)) return fail();
    const line = count(item.line);
    const state = oneOf<ZshValueState>(item.state, ZSH_VALUE_STATES);
    const rawReason = nullable(item.reason);
    // A dynamic PATH always says why; anything else never does.
    if (line < 1 || (state === "DYNAMIC") !== (rawReason !== undefined)) return fail();
    return {
      line,
      beforeBlock: flag(item.beforeBlock),
      operation: oneOf<ZshOperation>(item.operation, ZSH_OPERATIONS),
      state,
      ...(rawReason === undefined
        ? {}
        : { reason: oneOf<ZshDynamicReason>(rawReason, ZSH_REASONS) }),
      segments: list(item.segments, MAX_ZSH_SEGMENTS).map(decodeZshSegment),
    };
  });
  const dynamicPathLines = list(value.dynamicPathLines, MAX_ZSH_OUTSIDE_ROWS).map(
    (item): ZshOutsideDynamicLine => {
      if (!isRecord(item)) return fail();
      const line = count(item.line);
      const text = optionalText(nullable(item.text), MAX_INLINE_CHARS);
      const withheld = flag(item.withheld);
      const rawReason = nullable(item.reason);
      if (line < 1 || withheld !== (text === undefined)) return fail();
      return {
        line,
        beforeBlock: flag(item.beforeBlock),
        ...(rawReason === undefined
          ? {}
          : { reason: oneOf<ZshDynamicReason>(rawReason, ZSH_REASONS) }),
        ...(text === undefined ? {} : { text }),
        withheld,
      };
    },
  );
  return { variables, path, dynamicPathLines, truncated: flag(value.truncated) };
}

function decodeZshEditStateFields(value: Record<string, unknown>): ZshEditState {
  const file = oneOf<ZshFileKey>(value.file, ZSH_FILE_KEYS);
  const exists = flag(value.exists);
  const rawHash = nullable(value.contentHash);
  const contentHash =
    rawHash === undefined
      ? undefined
      : typeof rawHash === "string" && HASH_PATTERN.test(rawHash)
        ? rawHash
        : fail();
  const enabled = flag(value.enabled);
  const rawGrant = nullable(value.grantId);
  const grantId =
    rawGrant === undefined
      ? undefined
      : typeof rawGrant === "string" && isGrantId(rawGrant)
        ? rawGrant
        : fail();
  // A file has a content hash exactly when it exists, and editing is enabled
  // exactly when there is an authorization to revoke.
  if (exists !== (contentHash !== undefined) || enabled !== (grantId !== undefined)) {
    return fail();
  }
  return {
    file,
    name: value.name === ZSH_FILE_NAMES[file] ? ZSH_FILE_NAMES[file] : fail(),
    appliesTo: oneOf<ZshAppliesTo>(value.appliesTo, ZSH_APPLIES_TO),
    position: count(value.position),
    displayPath: displayPathText(value.displayPath),
    fullPath: absolutePath(value.fullPath),
    exists,
    ...(contentHash === undefined ? {} : { contentHash }),
    enabled,
    ...(grantId === undefined ? {} : { grantId }),
    block: decodeZshEditBlock(value.block),
    outside: decodeZshOutside(value.outside),
  };
}

export function decodeZshEditOutcome(value: unknown): ZshEditOutcome {
  if (!isRecord(value)) return fail();
  switch (value.status) {
    case "READY":
      return { status: "READY", ...decodeZshEditStateFields(value) };
    case "UNAVAILABLE":
      return {
        status: "UNAVAILABLE",
        reason: oneOf<FailureKind>(value.reason, FAILURE_KINDS),
        message: boundedText(value.message, MAX_MESSAGE_LENGTH),
      };
    case "OUTSIDE_HOME":
    case "NOT_LOCATED":
      return {
        status: value.status,
        message: boundedText(value.message, MAX_MESSAGE_LENGTH),
      };
    default:
      return fail();
  }
}

export function decodeZshEditEnabled(value: unknown): ZshEditEnabled {
  if (!isRecord(value)) return fail();
  if (typeof value.grantId !== "string" || !isGrantId(value.grantId)) return fail();
  return {
    file: oneOf<ZshFileKey>(value.file, ZSH_FILE_KEYS),
    displayPath: displayPathText(value.displayPath),
    fullPath: absolutePath(value.fullPath),
    exists: flag(value.exists),
    grantId: value.grantId,
  };
}

function decodeZshVariableChange(value: unknown): ZshVariableChange {
  if (!isRecord(value)) return fail();
  const change = oneOf<EnvChangeKind>(value.change, CHANGE_KINDS);
  const secret = flag(value.secret);
  const omitted = flag(value.omitted);
  const before = optionalText(value.before, MAX_INLINE_CHARS);
  const after = optionalText(value.after, MAX_INLINE_CHARS);
  const expectedBefore = change !== "ADD";
  const expectedAfter = change !== "REMOVE";
  // A side that does not exist for this kind of change never carries text.
  if ((!expectedBefore && before !== undefined) || (!expectedAfter && after !== undefined)) {
    return fail();
  }
  const absent =
    (expectedBefore && before === undefined ? 1 : 0) +
    (expectedAfter && after === undefined ? 1 : 0);
  // A secret never arrives with text; a value is only absent for a stated reason.
  if (secret) {
    if (before !== undefined || after !== undefined || omitted) return fail();
  } else if (omitted !== absent > 0) {
    return fail();
  }
  return {
    name: zshName(value.name),
    change,
    secret,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    omitted,
  };
}

function pathItems(value: unknown): string[] {
  return list(value, MAX_ZSH_PATH_ITEMS).map((item) => {
    const text = boundedText(item, MAX_PATH_LENGTH);
    return ZSH_PATH_ITEM_PATTERN.test(text) ? text : fail();
  });
}

function decodeZshWarning(value: unknown): ZshEditWarning {
  if (!isRecord(value)) return fail();
  const line = () => {
    const found = count(value.line);
    return found >= 1 ? found : fail();
  };
  switch (value.kind) {
    case "OVERRIDES_EARLIER_ASSIGNMENT":
    case "OVERRIDDEN_BY_LATER_ASSIGNMENT":
      return { kind: value.kind, name: zshName(value.name), line: line() };
    case "DUPLICATE_PATH_ITEM":
      return { kind: "DUPLICATE_PATH_ITEM", item: boundedText(value.item, MAX_PATH_LENGTH) };
    case "PATH_ITEM_ALSO_OUTSIDE":
      return {
        kind: "PATH_ITEM_ALSO_OUTSIDE",
        item: boundedText(value.item, MAX_PATH_LENGTH),
        line: line(),
      };
    case "DYNAMIC_PATH_OUTSIDE":
    case "LATER_PATH_ASSIGNMENT":
      return { kind: value.kind, line: line() };
    case "BLOCK_APPENDED":
    case "FILE_CREATED":
      return { kind: value.kind };
    default:
      return fail();
  }
}

export function decodeZshEditPreview(value: unknown): ZshEditPreview {
  const write = decodeResourceWritePreview(value);
  if (!isRecord(value)) return fail();
  // The raw text diff of the file is always withheld; a response that carries
  // one is not trusted, because it could hold secret values.
  if (!write.diff.redacted || write.diff.lines.length > 0) return fail();
  const variableChanges = list(value.variableChanges, MAX_ZSH_VARIABLES).map(
    decodeZshVariableChange,
  );
  const names = variableChanges.map((change) => change.name);
  const rawPath = nullable(value.pathChange);
  let pathChange: ZshPathChange | undefined;
  if (rawPath !== undefined) {
    if (!isRecord(rawPath)) return fail();
    pathChange = { before: pathItems(rawPath.before), after: pathItems(rawPath.after) };
  }
  // A preview always changes something, and never the same variable twice.
  if (
    (variableChanges.length === 0 && pathChange === undefined) ||
    new Set(names).size !== names.length
  ) {
    return fail();
  }
  const blockDiff = list(value.blockDiff, MAX_ZSH_DIFF_LINES).map(
    (line): ZshBlockDiffLine => {
      if (!isRecord(line)) return fail();
      const text = optionalText(line.text, MAX_ZSH_DIFF_TEXT);
      if (text === undefined) return fail();
      return { kind: oneOf<"ADDED" | "REMOVED">(line.kind, ["ADDED", "REMOVED"]), text };
    },
  );
  const file = oneOf<ZshFileKey>(value.file, ZSH_FILE_KEYS);
  return {
    ...write,
    file,
    appliesTo: oneOf<ZshAppliesTo>(value.appliesTo, ZSH_APPLIES_TO),
    position: count(value.position),
    displayPath: displayPathText(value.displayPath),
    fullPath: absolutePath(value.fullPath),
    createdBlock: flag(value.createdBlock),
    variableChanges,
    ...(pathChange === undefined ? {} : { pathChange }),
    blockDiff,
    warnings: list(value.warnings, MAX_ZSH_WARNINGS).map(decodeZshWarning),
    effectNote: boundedText(value.effectNote, MAX_MESSAGE_LENGTH),
  };
}

export function decodeZshEditExecution(value: unknown): ZshEditExecution {
  const execution = decodeResourceWriteExecution(value);
  if (!isRecord(value)) return fail();
  return {
    ...execution,
    file: oneOf<ZshFileKey>(value.file, ZSH_FILE_KEYS),
    effectNote: boundedText(value.effectNote, MAX_MESSAGE_LENGTH),
  };
}

/** The reason an edit cannot be sent, or `undefined` when it can. */
export function zshEditProblem(edit: ZshBlockEdit): string | undefined {
  const variables = edit.variables;
  if (!Array.isArray(variables) || variables.length > MAX_ZSH_VARIABLES) {
    return "一次保存最多改动 128 个变量。";
  }
  if (
    edit.path !== undefined &&
    (!Array.isArray(edit.path) ||
      edit.path.length > MAX_ZSH_PATH_ITEMS ||
      edit.path.some((item) => typeof item !== "string"))
  ) {
    return "PATH 列表最多 64 项，且每项必须是文本。";
  }
  if (variables.length === 0 && edit.path === undefined) return "没有需要保存的改动。";
  const seen = new Set<string>();
  for (const item of variables) {
    if (typeof item.name !== "string" || !KEY_PATTERN.test(item.name)) {
      return "变量名必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 255 个字符。";
    }
    if (ZSH_RESERVED_NAMES.includes(item.name)) {
      return "PATH 请通过 PATH 列表编辑，不能作为普通变量写入。";
    }
    if (seen.has(item.name)) return "同一个变量在一次保存里只能改动一次。";
    seen.add(item.name);
    if (item.op === "REMOVE") {
      if ("value" in item) return "删除不带值。";
    } else if (item.op === "SET") {
      if (typeof item.value !== "string" || [...item.value].length > MAX_EDIT_VALUE_CHARS) {
        return "值必须是不超过 8192 个字符的文本。";
      }
    } else {
      return "不支持的改动类型。";
    }
  }
  return undefined;
}

function wireTarget(target: ZshEditTarget): Record<string, unknown> | undefined {
  if (!ZSH_FILE_KEYS.includes(target.file)) return undefined;
  if (target.zdotdirGrantId !== undefined && !isGrantId(target.zdotdirGrantId)) {
    return undefined;
  }
  return {
    file: target.file,
    ...(target.zdotdirGrantId === undefined
      ? {}
      : { zdotdirGrantId: target.zdotdirGrantId }),
  };
}

const TARGET_PROBLEM = "The startup file or authorization id is invalid.";

/** Reads one startup file for editing: the block, what is outside it, whether editing is enabled. */
export function readZshEditState(target: ZshEditTarget): Promise<ZshEditOutcome> {
  const wire = wireTarget(target);
  if (wire === undefined) return invalidInput(TARGET_PROBLEM);
  return invokeCommand("read_zsh_edit_state", decodeZshEditOutcome, { input: wire });
}

/**
 * Creates the (revocable) authorization for exactly this startup file. The
 * backend builds the path; nothing is written.
 */
export function enableZshEdit(target: ZshEditTarget): Promise<ZshEditEnabled> {
  const wire = wireTarget(target);
  if (wire === undefined) return invalidInput(TARGET_PROBLEM);
  return invokeCommand("enable_zsh_edit", decodeZshEditEnabled, { input: wire });
}

function wireVariableEdit(edit: ZshVariableEdit): Record<string, unknown> {
  return edit.op === "SET"
    ? { op: "SET", name: edit.name, value: edit.value }
    : { op: "REMOVE", name: edit.name };
}

/**
 * Previews a block edit. `expectedHash` is the hash of the content the editor
 * showed (`undefined` for a file that does not exist yet); a changed file is
 * refused, never merged.
 */
export function previewZshEdit(
  target: ZshEditTarget,
  expectedHash: string | undefined,
  edit: ZshBlockEdit,
): Promise<ZshEditPreview> {
  const wire = wireTarget(target);
  if (wire === undefined) return invalidInput(TARGET_PROBLEM);
  if (expectedHash !== undefined && !HASH_PATTERN.test(expectedHash)) {
    return invalidInput("The content hash is invalid.");
  }
  const problem = zshEditProblem(edit);
  if (problem !== undefined) return invalidInput(problem);
  return invokeCommand("preview_zsh_edit", decodeZshEditPreview, {
    input: {
      ...wire,
      expectedHash: expectedHash ?? null,
      edit: {
        variables: edit.variables.map(wireVariableEdit),
        ...(edit.path === undefined ? {} : { path: [...edit.path] }),
      },
    },
  });
}

/**
 * Confirms a previewed edit. A rejection means nothing was changed; a
 * resolved value means the transaction ran, so read `outcome.status` and
 * `outcome.fileState` for what the file really contains.
 */
export function executeZshEdit(input: {
  readonly operationId: string;
  readonly target: ZshEditTarget;
}): Promise<ZshEditExecution> {
  if (typeof input.operationId !== "string" || input.operationId.length === 0) {
    return invalidInput("Operation id is invalid.");
  }
  const wire = wireTarget(input.target);
  if (wire === undefined) return invalidInput(TARGET_PROBLEM);
  return invokeCommand("execute_zsh_edit", decodeZshEditExecution, {
    input: { operationId: input.operationId, ...wire },
  });
}
