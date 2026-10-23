import {
  DEFAULT_ENV_PATTERNS,
  type EntryFlag,
  type FailureKind,
  type PartialReason,
  type ScanLimits,
  type ScanSettings,
  type SkipReason,
} from "../../ipc/environment";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { zhTranslate } from "./zhTranslate";

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

function patternProblem(
  pattern: string,
  recursive: boolean,
  t: TranslateFunction,
): string | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return t("env.model.pattern.tooLong", { pattern: `${pattern.slice(0, 20)}…` });
  }
  if (pattern.startsWith("/")) {
    return t("env.model.pattern.absolute", { pattern });
  }
  if (pattern.includes("**")) {
    return t("env.model.pattern.doubleStar", { pattern });
  }
  if (!PATTERN_CHARACTERS.test(pattern)) {
    return t("env.model.pattern.characters", { pattern });
  }
  if (pattern.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return t("env.model.pattern.emptySegment", { pattern });
  }
  if (pattern.includes("/") && !recursive) {
    return t("env.model.pattern.needsRecursive", { pattern });
  }
  return undefined;
}

/** Mirrors the backend rules for early feedback; the backend still decides. */
export function checkSettings(
  patternsText: string,
  recursive: boolean,
  t: TranslateFunction = zhTranslate,
): SettingsCheck {
  const patterns = parsePatternsText(patternsText);
  if (patterns.length === 0) {
    return { ok: false, message: t("env.model.pattern.none") };
  }
  if (patterns.length > MAX_PATTERNS) {
    return { ok: false, message: t("env.model.pattern.tooMany") };
  }
  for (const pattern of patterns) {
    const message = patternProblem(pattern, recursive, t);
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

export function partialReasonText(
  reason: PartialReason,
  limits: ScanLimits,
  t: TranslateFunction = zhTranslate,
): string {
  switch (reason) {
    case "ENTRY_LIMIT":
      return t("env.model.partial.entryLimit", { maxEntries: limits.maxEntries });
    case "MATCH_LIMIT":
      return t("env.model.partial.matchLimit", { maxMatches: limits.maxMatches });
    case "DEPTH_LIMIT":
      return t("env.model.partial.depthLimit", { maxDepth: limits.maxDepth });
    case "UNREADABLE_DIRECTORY":
      return t("env.model.partial.unreadableDirectory");
  }
}

const SKIP_KEYS: Record<SkipReason, MessageKey> = {
  OUTSIDE_LINK: "env.model.skip.outsideLink",
  PROTECTED: "env.model.skip.protected",
  UNREADABLE: "env.model.skip.unreadable",
  BROKEN_LINK: "env.model.skip.brokenLink",
  INVALID_NAME: "env.model.skip.invalidName",
  NOT_REGULAR: "env.model.skip.notRegular",
};

export function skipReasonText(reason: SkipReason, t: TranslateFunction = zhTranslate): string {
  return t(SKIP_KEYS[reason]);
}

const FAILURE_KEYS: Record<FailureKind, MessageKey> = {
  NOT_FOUND: "env.model.failure.notFound",
  PERMISSION_DENIED: "env.model.failure.permissionDenied",
  MALFORMED: "env.model.failure.malformed",
  TOO_LARGE: "env.model.failure.tooLarge",
  UNSUPPORTED: "env.model.failure.unsupported",
  EXCLUDED: "env.model.failure.excluded",
  IO: "env.model.failure.io",
};

export function failureText(kind: FailureKind, t: TranslateFunction = zhTranslate): string {
  return t(FAILURE_KEYS[kind]);
}

const FLAG_KEYS: Record<EntryFlag, { label: MessageKey; hint: MessageKey }> = {
  DUPLICATE_KEY: { label: "env.model.flag.duplicateKey.label", hint: "env.model.flag.duplicateKey.hint" },
  INTERPOLATION: { label: "env.model.flag.interpolation.label", hint: "env.model.flag.interpolation.hint" },
  COMMAND_SUBSTITUTION: {
    label: "env.model.flag.commandSubstitution.label",
    hint: "env.model.flag.commandSubstitution.hint",
  },
  MULTILINE_VALUE: { label: "env.model.flag.multilineValue.label", hint: "env.model.flag.multilineValue.hint" },
};

export function flagText(
  flag: EntryFlag,
  t: TranslateFunction = zhTranslate,
): { label: string; hint: string } {
  const keys = FLAG_KEYS[flag];
  return { label: t(keys.label), hint: t(keys.hint) };
}

export type DotenvEditIntent =
  | { readonly kind: "addition" }
  | { readonly kind: "entry"; readonly line: number };

export interface DotenvEditFocus {
  readonly id: number;
  readonly target: DotenvEditIntent;
}
