import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";
import { isGrantId } from "./grants";

// Environment files are addressed by an authorization id plus a path relative
// to it; the frontend never sends or receives an absolute path. Secret values
// are not part of any list payload: they arrive only from the explicit
// `revealEnvironmentValue` call.

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
