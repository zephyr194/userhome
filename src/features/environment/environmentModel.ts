import type { AppError } from "../../ipc/core";
import {
  DEFAULT_ENV_PATTERNS,
  type EntryFlag,
  type EnvFileOutcome,
  type EnvFileView,
  type EnvRow,
  type FailureKind,
  type PartialReason,
  type ScanLimits,
  type ScanOutcome,
  type ScanSettings,
  type SkipReason,
} from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";

// ---- scan settings -------------------------------------------------------

export const DEFAULT_PATTERNS_TEXT = DEFAULT_ENV_PATTERNS.join("\n");

const MAX_PATTERNS = 16;
const MAX_PATTERN_LENGTH = 128;
const PATTERN_CHARACTERS = /^[\p{L}\p{N}._\-+@=,/*?]+$/u;

export type SettingsCheck =
  | { readonly ok: true; readonly settings: ScanSettings }
  | { readonly ok: false; readonly message: string };

/** One pattern per line (or separated by spaces); duplicates are dropped. */
export function parsePatternsText(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter((pattern) => pattern !== ""))];
}

function patternProblem(pattern: string, recursive: boolean): string | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `pattern「${pattern.slice(0, 20)}…」超过 128 个字符。`;
  }
  if (pattern.startsWith("/")) {
    return `pattern「${pattern}」是绝对路径；请使用相对目录的写法。`;
  }
  if (pattern.includes("**")) {
    return `pattern「${pattern}」不受支持：只支持 * 和 ?，不支持 **。`;
  }
  if (!PATTERN_CHARACTERS.test(pattern)) {
    return `pattern「${pattern}」含不支持的字符：只支持字母、数字、. _ - + @ = , / 以及 * 和 ?。`;
  }
  if (pattern.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return `pattern「${pattern}」不能含空段、. 或 .. 段。`;
  }
  if (pattern.includes("/") && !recursive) {
    return `pattern「${pattern}」包含目录，需要先开启递归扫描。`;
  }
  return undefined;
}

/** Mirrors the backend rules for early feedback; the backend still decides. */
export function checkSettings(
  patternsText: string,
  recursive: boolean,
): SettingsCheck {
  const patterns = parsePatternsText(patternsText);
  if (patterns.length === 0) {
    return { ok: false, message: "至少需要一个 pattern。" };
  }
  if (patterns.length > MAX_PATTERNS) {
    return { ok: false, message: "pattern 最多 16 个。" };
  }
  for (const pattern of patterns) {
    const message = patternProblem(pattern, recursive);
    if (message) return { ok: false, message };
  }
  return { ok: true, settings: { patterns, recursive } };
}

export function sameSettings(left: ScanSettings, right: ScanSettings): boolean {
  return (
    left.recursive === right.recursive &&
    left.patterns.length === right.patterns.length &&
    left.patterns.every((pattern, index) => pattern === right.patterns[index])
  );
}

// ---- page state ----------------------------------------------------------

export type GrantsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly grants: readonly GrantSummary[] }
  | { readonly status: "error"; readonly error: AppError };

export type ScanState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly requestId: number }
  | {
      readonly status: "ready";
      readonly requestId: number;
      readonly outcome: ScanOutcome;
      /** The settings this result was produced with; reads reuse them. */
      readonly settings: ScanSettings;
    }
  | {
      readonly status: "error";
      readonly requestId: number;
      readonly error: AppError;
    };

export type FileState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly requestId: number;
      readonly path: string;
    }
  | {
      readonly status: "loaded";
      readonly requestId: number;
      readonly path: string;
      readonly outcome: EnvFileOutcome;
    }
  | {
      readonly status: "error";
      readonly requestId: number;
      readonly path: string;
      readonly error: AppError;
    };

export interface EnvironmentState {
  readonly grants: GrantsState;
  readonly selectedGrantId?: string;
  readonly patternsText: string;
  readonly recursive: boolean;
  readonly scan: ScanState;
  readonly selectedPath?: string;
  readonly file: FileState;
}

export const INITIAL_ENVIRONMENT_STATE: EnvironmentState = {
  grants: { status: "loading" },
  patternsText: DEFAULT_PATTERNS_TEXT,
  recursive: false,
  scan: { status: "idle" },
  file: { status: "idle" },
};

export type EnvironmentAction =
  | { type: "grantsLoaded"; grants: readonly GrantSummary[] }
  | { type: "grantsFailed"; error: AppError }
  | { type: "grantSelected"; grantId: string | undefined }
  | { type: "patternsChanged"; text: string }
  | { type: "recursiveChanged"; recursive: boolean }
  | { type: "scanRequested"; requestId: number }
  | {
      type: "scanSucceeded";
      requestId: number;
      outcome: ScanOutcome;
      settings: ScanSettings;
    }
  | { type: "scanFailed"; requestId: number; error: AppError }
  | { type: "fileRequested"; requestId: number; path: string }
  | { type: "fileLoaded"; requestId: number; outcome: EnvFileOutcome }
  | { type: "fileFailed"; requestId: number; error: AppError };

// The Caddy work directory is managed only by the Caddy page, never as a generic directory.
function directoryGrants(grants: readonly GrantSummary[]): GrantSummary[] {
  return grants.filter(
    (grant) => grant.kind === "DIRECTORY" && grant.purpose !== "CADDY_WORK_DIR",
  );
}

const CLEARED = {
  scan: { status: "idle" },
  selectedPath: undefined,
  file: { status: "idle" },
} as const;

/**
 * Responses carry the id of the request that produced them; one that is not
 * the current request is ignored, so a slow answer for another directory,
 * scan or file never replaces what the user is looking at.
 */
export function environmentReducer(
  state: EnvironmentState,
  action: EnvironmentAction,
): EnvironmentState {
  switch (action.type) {
    case "grantsLoaded": {
      const grants = directoryGrants(action.grants);
      const stillThere = grants.some(
        (grant) => grant.id === state.selectedGrantId,
      );
      const selectedGrantId = stillThere ? state.selectedGrantId : grants[0]?.id;
      return {
        ...state,
        grants: { status: "ready", grants },
        selectedGrantId,
        ...(selectedGrantId === state.selectedGrantId ? {} : CLEARED),
      };
    }
    case "grantsFailed":
      return {
        ...state,
        grants: { status: "error", error: action.error },
        selectedGrantId: undefined,
        ...CLEARED,
      };
    case "grantSelected":
      return action.grantId === state.selectedGrantId
        ? state
        : { ...state, selectedGrantId: action.grantId, ...CLEARED };
    case "patternsChanged":
      return { ...state, patternsText: action.text };
    case "recursiveChanged":
      return { ...state, recursive: action.recursive };
    case "scanRequested":
      return {
        ...state,
        scan: { status: "loading", requestId: action.requestId },
        selectedPath: undefined,
        file: { status: "idle" },
      };
    case "scanSucceeded":
      return state.scan.status === "loading" &&
        state.scan.requestId === action.requestId
        ? {
            ...state,
            scan: {
              status: "ready",
              requestId: action.requestId,
              outcome: action.outcome,
              settings: action.settings,
            },
          }
        : state;
    case "scanFailed":
      return state.scan.status === "loading" &&
        state.scan.requestId === action.requestId
        ? {
            ...state,
            scan: {
              status: "error",
              requestId: action.requestId,
              error: action.error,
            },
          }
        : state;
    case "fileRequested":
      return {
        ...state,
        selectedPath: action.path,
        file: {
          status: "loading",
          requestId: action.requestId,
          path: action.path,
        },
      };
    case "fileLoaded":
      return state.file.status === "loading" &&
        state.file.requestId === action.requestId
        ? {
            ...state,
            file: {
              status: "loaded",
              requestId: action.requestId,
              path: state.file.path,
              outcome: action.outcome,
            },
          }
        : state;
    case "fileFailed":
      return state.file.status === "loading" &&
        state.file.requestId === action.requestId
        ? {
            ...state,
            file: {
              status: "error",
              requestId: action.requestId,
              path: state.file.path,
              error: action.error,
            },
          }
        : state;
  }
}

// ---- lazily fetched secret value -----------------------------------------

export type LazyValueState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: string }
  | { readonly status: "failed"; readonly message: string };

export type LazyValueAction =
  | { type: "load" }
  | { type: "loaded"; value: string }
  | { type: "failed"; message: string }
  | { type: "discard" };

export const INITIAL_LAZY_VALUE: LazyValueState = { status: "idle" };

/**
 * The plaintext only lives in `ready` and is dropped by `discard`, which the
 * view dispatches when focus leaves the entry or another entry is shown.
 */
export function lazyValueReducer(
  state: LazyValueState,
  action: LazyValueAction,
): LazyValueState {
  switch (action.type) {
    case "load":
      return state.status === "loading" ? state : { status: "loading" };
    case "loaded":
      return state.status === "loading"
        ? { status: "ready", value: action.value }
        : state;
    case "failed":
      return state.status === "loading"
        ? { status: "failed", message: action.message }
        : state;
    case "discard":
      return state.status === "idle" ? state : INITIAL_LAZY_VALUE;
  }
}

// ---- wording -------------------------------------------------------------

const PARTIAL_TEXT: Record<PartialReason, (limits: ScanLimits) => string> = {
  ENTRY_LIMIT: (limits) =>
    `已达到枚举上限（${limits.maxEntries} 项），后面的目录项没有检查。`,
  MATCH_LIMIT: (limits) =>
    `已达到匹配上限（${limits.maxMatches} 个文件），其余匹配文件没有列出。`,
  DEPTH_LIMIT: (limits) =>
    `已达到深度上限（${limits.maxDepth} 层），更深的目录没有扫描。`,
  UNREADABLE_DIRECTORY: () => "部分子目录无法读取（权限不足），其中的文件没有列出。",
};

export function partialReasonText(
  reason: PartialReason,
  limits: ScanLimits,
): string {
  return PARTIAL_TEXT[reason](limits);
}

const SKIP_TEXT: Record<SkipReason, string> = {
  OUTSIDE_LINK: "符号链接指向授权目录之外，已拒绝",
  PROTECTED: "受保护的凭据位置，已跳过",
  UNREADABLE: "无权限读取",
  BROKEN_LINK: "符号链接已失效",
  INVALID_NAME: "名称不是合法文本，已跳过",
  NOT_REGULAR: "不是普通文件",
};

export function skipReasonText(reason: SkipReason): string {
  return SKIP_TEXT[reason];
}

const FAILURE_TEXT: Record<FailureKind, string> = {
  NOT_FOUND: "文件不存在",
  PERMISSION_DENIED: "无权限读取",
  MALFORMED: "格式错误（不是有效的 UTF-8 文本）",
  TOO_LARGE: "文件过大（超过 1 MiB）",
  UNSUPPORTED: "不支持（不是普通文件）",
  EXCLUDED: "已排除或授权已失效",
  IO: "读取出错",
};

export function failureText(kind: FailureKind): string {
  return FAILURE_TEXT[kind];
}

const FLAG_TEXT: Record<EntryFlag, { label: string; hint: string }> = {
  DUPLICATE_KEY: { label: "冲突：重复键", hint: "同一个键出现多次，工具不会判断哪一个生效。" },
  INTERPOLATION: { label: "动态：变量插值", hint: "值含 $VAR 或 ${VAR}，按原文显示，没有展开。" },
  COMMAND_SUBSTITUTION: { label: "动态：命令替换", hint: "值含 $(…) 或反引号，按原文显示，没有执行。" },
  MULTILINE_VALUE: { label: "不支持：多行值", hint: "引号值跨越多行，保持原样，不做规范化。" },
};

export function flagText(flag: EntryFlag): { label: string; hint: string } {
  return FLAG_TEXT[flag];
}

export function rowKey(row: EnvRow): string {
  return `${row.line}:${row.kind}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Entries whose value needs an explicit fetch: secrets and very long values. */
export function needsFetch(row: Extract<EnvRow, { kind: "ENTRY" }>): boolean {
  return row.secret || (row.hasValue && row.value === undefined);
}

// ---- same keys in one file -------------------------------------------------

export type DotenvEditIntent =
  | { readonly kind: "addition" }
  | { readonly kind: "entry"; readonly line: number };

export interface DotenvEditFocus {
  readonly id: number;
  readonly target: DotenvEditIntent;
}

export interface DotenvDisplay {
  readonly rows: readonly EnvRow[];
  /** Earlier lines a shown entry replaces, keyed by the shown line. */
  readonly replaced: ReadonlyMap<number, readonly number[]>;
  readonly entryCount: number;
  readonly secretCount: number;
  readonly flaggedCount: number;
}

/**
 * A key that appears more than once in one file shows only its last line, the
 * one that takes effect. A file that was cut short is shown as read: a later
 * line for the same key may sit past the cut.
 */
export function dotenvDisplay(file: EnvFileView): DotenvDisplay {
  const unchanged: DotenvDisplay = {
    rows: file.rows,
    replaced: new Map(),
    entryCount: file.entryCount,
    secretCount: file.secretCount,
    flaggedCount: file.flaggedCount,
  };
  if (file.rowsTruncated) return unchanged;

  const lastLine = new Map<string, number>();
  for (const row of file.rows) {
    if (row.kind === "ENTRY") lastLine.set(row.key, row.line);
  }
  const hidden = new Set<number>();
  const replaced = new Map<number, number[]>();
  for (const row of file.rows) {
    if (row.kind !== "ENTRY") continue;
    const winner = lastLine.get(row.key) ?? row.line;
    if (winner === row.line) continue;
    hidden.add(row.line);
    replaced.set(winner, [...(replaced.get(winner) ?? []), row.line]);
  }
  if (hidden.size === 0) return unchanged;

  let { entryCount, secretCount, flaggedCount } = file;
  const rows: EnvRow[] = [];
  for (const row of file.rows) {
    if (row.kind !== "ENTRY") {
      rows.push(row);
      continue;
    }
    if (hidden.has(row.line)) {
      entryCount -= 1;
      if (row.secret) secretCount -= 1;
      if (row.flags.length > 0) flaggedCount -= 1;
      continue;
    }
    if (!replaced.has(row.line)) {
      rows.push(row);
      continue;
    }
    const flags = row.flags.filter((flag) => flag !== "DUPLICATE_KEY");
    if (flags.length === 0 && row.flags.length > 0) flaggedCount -= 1;
    rows.push({ ...row, flags });
  }
  return { rows, replaced, entryCount, secretCount, flaggedCount };
}
