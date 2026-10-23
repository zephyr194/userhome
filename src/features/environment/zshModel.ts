import type { AppError } from "../../ipc/core";
import type {
  ZshAppliesTo,
  ZshDynamicReason,
  ZshEntryRow,
  ZshFile,
  ZshFileDetail,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
  ZshUndeterminedReason,
  ZshValueState,
  ZshZdotdir,
} from "../../ipc/environment";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { failureText } from "./environmentModel";
import { zhTranslate } from "./zhTranslate";

// ---- page state ----------------------------------------------------------

export type ZshLoadState =
  | {
      readonly status: "loading";
      readonly requestId: number;
      /** The overview shown before a reload started, kept until it answers. */
      readonly previous?: ZshOverview;
    }
  | {
      readonly status: "ready";
      readonly requestId: number;
      readonly overview: ZshOverview;
    }
  | {
      readonly status: "error";
      readonly requestId: number;
      readonly error: AppError;
    };

export interface ZshState {
  readonly load: ZshLoadState;
  /** Directory authorization the user chose for an undetermined `ZDOTDIR`. */
  readonly zdotdirGrantId?: string;
}

export const INITIAL_ZSH_STATE: ZshState = {
  load: { status: "loading", requestId: 0 },
};

export type ZshAction =
  | { type: "loadRequested"; requestId: number }
  | { type: "loaded"; requestId: number; overview: ZshOverview }
  | { type: "loadFailed"; requestId: number; error: AppError }
  | { type: "directoryChosen"; grantId: string }
  | { type: "directoryCleared" };

/**
 * Responses carry the id of the request that produced them; one that is not
 * the request currently loading is ignored, so a slow answer never replaces
 * what the user is looking at.
 */
export function zshReducer(state: ZshState, action: ZshAction): ZshState {
  switch (action.type) {
    case "loadRequested": {
      const previous =
        state.load.status === "ready"
          ? state.load.overview
          : state.load.status === "loading"
            ? state.load.previous
            : undefined;
      return {
        ...state,
        load: {
          status: "loading",
          requestId: action.requestId,
          ...(previous === undefined ? {} : { previous }),
        },
      };
    }
    case "loaded":
      return state.load.status === "loading" &&
        state.load.requestId === action.requestId
        ? {
            ...state,
            load: {
              status: "ready",
              requestId: action.requestId,
              overview: action.overview,
            },
          }
        : state;
    case "loadFailed":
      return state.load.status === "loading" &&
        state.load.requestId === action.requestId
        ? {
            ...state,
            load: {
              status: "error",
              requestId: action.requestId,
              error: action.error,
            },
          }
        : state;
    case "directoryChosen":
      return { ...state, zdotdirGrantId: action.grantId };
    case "directoryCleared":
      return { load: state.load };
  }
}

// ---- wording -------------------------------------------------------------

export function sourceLabel(t: TranslateFunction = zhTranslate): string {
  return t("env.model.zsh.sourceLabel");
}

const APPLIES_TO_KEYS: Record<ZshAppliesTo, { label: MessageKey; detail: MessageKey }> = {
  ALL: { label: "env.model.zsh.appliesTo.ALL.label", detail: "env.model.zsh.appliesTo.ALL.detail" },
  LOGIN: { label: "env.model.zsh.appliesTo.LOGIN.label", detail: "env.model.zsh.appliesTo.LOGIN.detail" },
  INTERACTIVE: {
    label: "env.model.zsh.appliesTo.INTERACTIVE.label",
    detail: "env.model.zsh.appliesTo.INTERACTIVE.detail",
  },
};

export function appliesToText(appliesTo: ZshAppliesTo, t: TranslateFunction = zhTranslate) {
  const keys = APPLIES_TO_KEYS[appliesTo];
  return { label: t(keys.label), detail: t(keys.detail) };
}

const VALUE_STATE_KEYS: Record<ZshValueState, { label: MessageKey; hint: MessageKey }> = {
  STATIC: {
    label: "env.model.zsh.valueState.STATIC.label",
    hint: "env.model.zsh.valueState.STATIC.hint",
  },
  REFERENCE: {
    label: "env.model.zsh.valueState.REFERENCE.label",
    hint: "env.model.zsh.valueState.REFERENCE.hint",
  },
  DYNAMIC: {
    label: "env.model.zsh.valueState.DYNAMIC.label",
    hint: "env.model.zsh.valueState.DYNAMIC.hint",
  },
};

export function valueStateText(state: ZshValueState, t: TranslateFunction = zhTranslate) {
  const keys = VALUE_STATE_KEYS[state];
  return { label: t(keys.label), hint: t(keys.hint) };
}

const REASON_KEYS: Record<ZshDynamicReason, { label: MessageKey; hint: MessageKey }> = {
  COMMAND_SUBSTITUTION: {
    label: "env.model.zsh.reason.COMMAND_SUBSTITUTION.label",
    hint: "env.model.zsh.reason.COMMAND_SUBSTITUTION.hint",
  },
  ARITHMETIC: { label: "env.model.zsh.reason.ARITHMETIC.label", hint: "env.model.zsh.reason.ARITHMETIC.hint" },
  UNRESOLVED_REFERENCE: {
    label: "env.model.zsh.reason.UNRESOLVED_REFERENCE.label",
    hint: "env.model.zsh.reason.UNRESOLVED_REFERENCE.hint",
  },
  CONDITIONAL: { label: "env.model.zsh.reason.CONDITIONAL.label", hint: "env.model.zsh.reason.CONDITIONAL.hint" },
  BLOCK: { label: "env.model.zsh.reason.BLOCK.label", hint: "env.model.zsh.reason.BLOCK.hint" },
  SOURCE: { label: "env.model.zsh.reason.SOURCE.label", hint: "env.model.zsh.reason.SOURCE.hint" },
  EVAL: { label: "env.model.zsh.reason.EVAL.label", hint: "env.model.zsh.reason.EVAL.hint" },
  FUNCTION_DEFINITION: {
    label: "env.model.zsh.reason.FUNCTION_DEFINITION.label",
    hint: "env.model.zsh.reason.FUNCTION_DEFINITION.hint",
  },
  ALIAS: { label: "env.model.zsh.reason.ALIAS.label", hint: "env.model.zsh.reason.ALIAS.hint" },
  COMPOUND: { label: "env.model.zsh.reason.COMPOUND.label", hint: "env.model.zsh.reason.COMPOUND.hint" },
  LINE_CONTINUATION: {
    label: "env.model.zsh.reason.LINE_CONTINUATION.label",
    hint: "env.model.zsh.reason.LINE_CONTINUATION.hint",
  },
  HERE_DOC: { label: "env.model.zsh.reason.HERE_DOC.label", hint: "env.model.zsh.reason.HERE_DOC.hint" },
  MULTILINE_QUOTE: {
    label: "env.model.zsh.reason.MULTILINE_QUOTE.label",
    hint: "env.model.zsh.reason.MULTILINE_QUOTE.hint",
  },
  EXPANSION: { label: "env.model.zsh.reason.EXPANSION.label", hint: "env.model.zsh.reason.EXPANSION.hint" },
};

export function reasonText(reason: ZshDynamicReason, t: TranslateFunction = zhTranslate) {
  const keys = REASON_KEYS[reason];
  return { label: t(keys.label), hint: t(keys.hint) };
}

const UNDETERMINED_KEYS: Record<ZshUndeterminedReason, MessageKey> = {
  DYNAMIC: "env.model.zsh.undetermined.DYNAMIC",
  MULTIPLE: "env.model.zsh.undetermined.MULTIPLE",
  UNSUPPORTED_FORM: "env.model.zsh.undetermined.UNSUPPORTED_FORM",
  ZSHENV_NOT_READ: "env.model.zsh.undetermined.ZSHENV_NOT_READ",
  PARENT_SEGMENT: "env.model.zsh.undetermined.PARENT_SEGMENT",
};

export function undeterminedText(
  reason: ZshUndeterminedReason,
  t: TranslateFunction = zhTranslate,
): string {
  return t(UNDETERMINED_KEYS[reason]);
}

/** PATH items may be empty; an empty item means the current directory. */
export function pathSegmentText(text: string, t: TranslateFunction = zhTranslate): string {
  return text === "" ? t("env.model.zsh.pathSegment.empty") : text;
}

export type SummaryTone = "neutral" | "success" | "warning" | "danger";

export interface ZdotdirSummary {
  readonly title: string;
  readonly detail: string;
  readonly tone: SummaryTone;
  /** The user must pick the directory; nothing is read until they do. */
  readonly needsChoice: boolean;
  /** The location comes from the user's choice (and can be cleared). */
  readonly selected: boolean;
  /** Why a directory the user chose could not be used. */
  readonly problem?: string;
}

export function zdotdirSummary(zdotdir: ZshZdotdir, t: TranslateFunction = zhTranslate): ZdotdirSummary {
  switch (zdotdir.status) {
    case "DEFAULT":
      return {
        title: t("env.model.zsh.zdotdir.DEFAULT.title"),
        detail: t("env.model.zsh.zdotdir.DEFAULT.detail"),
        tone: "neutral",
        needsChoice: false,
        selected: false,
      };
    case "STATIC":
      return {
        title: t("env.model.zsh.zdotdir.STATIC.title"),
        detail: t("env.model.zsh.zdotdir.STATIC.detail", {
          line: zdotdir.line,
          path: zdotdir.displayPath,
        }),
        tone: "success",
        needsChoice: false,
        selected: false,
      };
    case "OUTSIDE":
      return {
        title: t("env.model.zsh.zdotdir.OUTSIDE.title"),
        detail: t("env.model.zsh.zdotdir.OUTSIDE.detail", {
          line: zdotdir.line,
          path: zdotdir.displayPath,
        }),
        tone: "danger",
        needsChoice: false,
        selected: false,
      };
    case "SELECTED":
      return {
        title: t("env.model.zsh.zdotdir.SELECTED.title"),
        detail: t("env.model.zsh.zdotdir.SELECTED.detail", { path: zdotdir.displayPath }),
        tone: "warning",
        needsChoice: false,
        selected: true,
      };
    case "UNDETERMINED":
      return {
        title: t("env.model.zsh.zdotdir.UNDETERMINED.title"),
        detail: t("env.model.zsh.zdotdir.UNDETERMINED.detail", {
          reason: undeterminedText(zdotdir.reason, t),
        }),
        tone: "warning",
        needsChoice: true,
        selected: false,
        ...(zdotdir.selectionProblem === undefined
          ? {}
          : { problem: zdotdir.selectionProblem }),
      };
  }
}

export function stepStatus(
  step: Pick<ZshOrderStep, "scope">,
  t: TranslateFunction = zhTranslate,
): string | undefined {
  return step.scope === "SYSTEM" ? t("env.model.zsh.stepStatus.system") : undefined;
}

export function fileStatus(
  file: ZshFile,
  t: TranslateFunction = zhTranslate,
): { label: string; tone: SummaryTone } {
  const { outcome } = file;
  switch (outcome.status) {
    case "READY":
      return { label: t("env.model.zsh.file.ready"), tone: "success" };
    case "UNAVAILABLE":
      return outcome.reason === "NOT_FOUND"
        ? { label: t("env.model.zsh.file.notFound"), tone: "neutral" }
        : {
            label: t("env.model.zsh.file.unreadable", {
              reason: failureText(outcome.reason, t),
            }),
            tone: "danger",
          };
    case "OUTSIDE_HOME":
      return { label: t("env.model.zsh.file.outsideHome"), tone: "danger" };
    case "NOT_LOCATED":
      return { label: t("env.model.zsh.file.notLocated"), tone: "warning" };
  }
}

export interface ZshSummary {
  readonly kind: "ok" | "empty" | "partial";
  /** Files that could not be read for a reason other than being absent. */
  readonly problems: readonly string[];
}

/** A file that is absent contributes no entries, so it cannot override anything. */
function isAbsent(file: ZshFile): boolean {
  return file.outcome.status === "UNAVAILABLE" && file.outcome.reason === "NOT_FOUND";
}

function isUnreadable(file: ZshFile): boolean {
  return file.outcome.status !== "READY" && !isAbsent(file);
}

export function summarize(overview: ZshOverview, t: TranslateFunction = zhTranslate): ZshSummary {
  if (overview.files.every(isAbsent)) return { kind: "empty", problems: [] };
  const problems = overview.files
    .filter((file) => file.outcome.status !== "READY" && !isAbsent(file))
    .map((file) =>
      t("env.model.zsh.problem", { name: file.name, status: fileStatus(file, t).label }),
    );
  return { kind: problems.length > 0 ? "partial" : "ok", problems };
}


// ---- entries -------------------------------------------------------------

/** Entries whose value needs an explicit fetch: secrets and very long values. */
export function needsFetch(row: ZshEntryRow): boolean {
  return row.secret || (row.hasValue && row.value === undefined);
}

export type ZshEditIntent =
  | { readonly kind: "addition" }
  | { readonly kind: "variable"; readonly name: string; readonly line: number };

export interface ZshEditFocus {
  readonly id: number;
  readonly target: ZshEditIntent;
}

export interface ZshLocation {
  readonly fileName: string;
  readonly line: number;
  readonly appliesTo: ZshAppliesTo;
}

/** `appliesTo` is the scope of the row the note is shown on. */
export type ZshNameNote =
  | {
      readonly kind: "replaces";
      readonly appliesTo: ZshAppliesTo;
      readonly replaced: readonly ZshLocation[];
    }
  | {
      readonly kind: "narrower";
      readonly appliesTo: ZshAppliesTo;
      /** Later plain assignments that cover only some of the shells this row serves. */
      readonly narrower: readonly ZshLocation[];
    }
  | { readonly kind: "shared"; readonly appliesTo: ZshAppliesTo; readonly others: readonly ZshLocation[] }
  | {
      readonly kind: "unread";
      readonly appliesTo: ZshAppliesTo;
      /** Later files that could not be read and might assign the name again. */
      readonly unreadFiles: readonly string[];
    };

export interface ZshNameResolution {
  /** Entries a later one replaces, as `zshRowKey`. */
  readonly hidden: ReadonlySet<string>;
  /** Notes for shown entries whose name appears elsewhere, as `zshRowKey`. */
  readonly notes: ReadonlyMap<string, ZshNameNote>;
}

export function zshRowKey(file: ZshFileKey, line: number): string {
  return `${file}:${line}`;
}

interface NameItem {
  readonly file: ZshFile;
  readonly row: ZshEntryRow;
}

function nameLocation(item: NameItem): ZshLocation {
  return { fileName: item.file.name, line: item.row.line, appliesTo: item.file.appliesTo };
}

/** Whether a file read by `writer` is also read by every shell that reads `target`. */
function covers(writer: ZshAppliesTo, target: ZshAppliesTo): boolean {
  return writer === "ALL" || writer === target;
}

function setsValue(item: NameItem): boolean {
  return item.row.operation === "SET" && item.row.state !== "DYNAMIC";
}

/**
 * A later plain assignment hides an earlier one only where it covers every shell
 * that reads it: `.zshenv` (all shells) is still read by `zsh -c` after
 * `.zshrc` (interactive only) sets the name. An appending or dynamic assignment
 * says nothing about the final value, so nothing is hidden by it. A file that
 * could not be read after an occurrence may assign the name again, so the
 * occurrence is marked instead of treated as final. When any file was cut
 * short, nothing is resolved: a later occurrence may sit past the cut.
 */
export function resolveZshNames(overview: ZshOverview): ZshNameResolution {
  const files = [...overview.files].sort((left, right) => left.position - right.position);
  const truncated = files.some(
    (file) => file.outcome.status === "READY" && file.outcome.rowsTruncated,
  );
  if (truncated) return { hidden: new Set(), notes: new Map() };

  const unreadable = files.filter(isUnreadable);
  const byName = new Map<string, NameItem[]>();
  for (const file of files) {
    if (file.outcome.status !== "READY") continue;
    for (const row of file.outcome.rows) {
      if (row.kind !== "ENTRY") continue;
      const items = byName.get(row.name) ?? [];
      items.push({ file, row });
      byName.set(row.name, items);
    }
  }

  const hidden = new Set<string>();
  const notes = new Map<string, ZshNameNote>();
  for (const items of byName.values()) {
    items.forEach((item, index) => {
      const key = zshRowKey(item.file.file, item.row.line);
      const { appliesTo } = item.file;
      const earlier = items.slice(0, index);
      const later = items.slice(index + 1);
      if (later.some((other) => setsValue(other) && covers(other.file.appliesTo, appliesTo))) {
        hidden.add(key);
        return;
      }
      const unreadLater = unreadable.filter((file) => file.position > item.file.position);
      if (unreadLater.length > 0) {
        notes.set(key, { kind: "unread", appliesTo, unreadFiles: unreadLater.map((file) => file.name) });
        return;
      }
      const narrower = later.filter(setsValue);
      if (narrower.length > 0) {
        notes.set(key, { kind: "narrower", appliesTo, narrower: narrower.map(nameLocation) });
        return;
      }
      const replaced = setsValue(item)
        ? earlier.filter((other) => covers(appliesTo, other.file.appliesTo))
        : [];
      if (replaced.length > 0) {
        notes.set(key, { kind: "replaces", appliesTo, replaced: replaced.map(nameLocation) });
        return;
      }
      if (items.length > 1) {
        notes.set(key, {
          kind: "shared",
          appliesTo,
          others: items.filter((other) => other !== item).map(nameLocation),
        });
      }
    });
  }
  return { hidden, notes };
}

export interface ZshFileDisplay {
  readonly rows: readonly ZshRow[];
  readonly entryCount: number;
  readonly secretCount: number;
  readonly dynamicCount: number;
}

/** The rows a file shows after resolution, with its counts lowered to match. */
export function zshFileDisplay(
  file: ZshFileKey,
  detail: ZshFileDetail,
  resolution: ZshNameResolution,
): ZshFileDisplay {
  let { entryCount, secretCount, dynamicCount } = detail;
  const rows: ZshRow[] = [];
  for (const row of detail.rows) {
    if (row.kind === "ENTRY" && resolution.hidden.has(zshRowKey(file, row.line))) {
      entryCount -= 1;
      if (row.secret) secretCount -= 1;
      if (row.state === "DYNAMIC") dynamicCount -= 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, entryCount, secretCount, dynamicCount };
}

