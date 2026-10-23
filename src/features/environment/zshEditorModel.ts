import type { MessageKey, TranslateFunction } from "../../i18n";
import {
  MAX_EDIT_VALUE_CHARS,
  MAX_ZSH_PATH_ITEMS,
  MAX_ZSH_VARIABLES,
  type ZshBlockEdit,
  type ZshEditPreview,
  type ZshEditState,
  type ZshEditVariable,
  type ZshEditWarning,
  type ZshFileKey,
  type ZshVariableEdit,
} from "../../ipc/environment";
import { looksLikeSecretName } from "./dotenvEditorModel";
import { appliesToText } from "./zshModel";
import { zhTranslate } from "./zhTranslate";

// The backend decides what can be written and re-checks everything; the rules
// here only mirror it for early, per-field feedback. Secret values live in this
// state only while the user is editing: they are never stored in the browser,
// and neither the state nor the preview the backend returns carries one.

export { looksLikeSecretName };

// ---- field checks ------------------------------------------------------------

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
const RESERVED_NAMES: readonly string[] = ["PATH", "path"];
const MAX_PATH_ITEM_CHARS = 1024;
// Control characters and invisible line/direction marks: a value containing one
// would not stay a single visible line (the backend refuses it too).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;

export function nameProblem(name: string, t: TranslateFunction = zhTranslate): string | undefined {
  if (name === "") return t("env.zshEdit.name.empty");
  if (!NAME_PATTERN.test(name)) return t("env.zshEdit.name.pattern");
  if (RESERVED_NAMES.includes(name)) return t("env.zshEdit.name.reservedPath");
  return undefined;
}

export function valueProblem(value: string, t: TranslateFunction = zhTranslate): string | undefined {
  if (FORBIDDEN_CHARACTERS.test(value)) return t("env.zshEdit.value.forbidden");
  if ([...value].length > MAX_EDIT_VALUE_CHARS) {
    return t("env.zshEdit.value.tooLong", { max: MAX_EDIT_VALUE_CHARS });
  }
  return undefined;
}

export type PathNormalization =
  | { readonly ok: true; readonly item: string }
  | { readonly ok: false; readonly problem: string };

/**
 * The stored form of one PATH item: `~` and `${HOME}` become `$HOME`; anything
 * else must be an absolute literal path. An empty item would mean the current
 * directory, so it is refused.
 */
export function normalizePathItem(
  raw: string,
  t: TranslateFunction = zhTranslate,
): PathNormalization {
  const refuse = (problem: string): PathNormalization => ({ ok: false, problem });
  if (raw === "") return refuse(t("env.zshEdit.path.empty"));
  if (FORBIDDEN_CHARACTERS.test(raw)) return refuse(t("env.zshEdit.path.forbidden"));
  if (raw.trim() !== raw) return refuse(t("env.zshEdit.path.whitespace"));
  if (raw.includes(":")) return refuse(t("env.zshEdit.path.colon"));
  if ([...raw].length > MAX_PATH_ITEM_CHARS) {
    return refuse(t("env.zshEdit.path.tooLong", { max: MAX_PATH_ITEM_CHARS }));
  }
  for (const prefix of ["~", "$HOME", "${HOME}"]) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      if (rest === "" || rest.startsWith("/")) return { ok: true, item: `$HOME${rest}` };
    }
  }
  return raw.startsWith("/")
    ? { ok: true, item: raw }
    : refuse(t("env.zshEdit.path.notAbsolute"));
}

// ---- availability --------------------------------------------------------------

export type EditAvailability =
  | { readonly kind: "ready" }
  /** Editing has not been enabled for this file yet. */
  | { readonly kind: "needs-enable" }
  /** The block is damaged: nothing structured is written, nothing is repaired. */
  | { readonly kind: "blocked"; readonly reason: string };

export function editAvailability(
  state: ZshEditState,
  t: TranslateFunction = zhTranslate,
): EditAvailability {
  if (state.block.status === "BROKEN") {
    return {
      kind: "blocked",
      reason: t("env.zshEdit.block.broken", { message: state.block.message }),
    };
  }
  return state.enabled ? { kind: "ready" } : { kind: "needs-enable" };
}

export function managedVariables(state: ZshEditState): readonly ZshEditVariable[] {
  return state.block.status === "PRESENT" ? state.block.variables : [];
}

export function managedPath(state: ZshEditState): readonly string[] {
  return state.block.status === "PRESENT" ? state.block.path : [];
}

/** Existing variables that cannot be changed here, with the reason. */
export function variableEditability(
  variable: ZshEditVariable,
  t: TranslateFunction = zhTranslate,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!variable.secret && variable.hasValue && variable.value === undefined) {
    return { ok: false, reason: t("env.zshEdit.variable.tooLong", { max: 4096 }) };
  }
  return { ok: true };
}

// ---- drafts -----------------------------------------------------------------------

export type VariableMode = "keep" | "set" | "remove";

export interface VariableDraft {
  readonly mode: VariableMode;
  /** The new text; empty for a secret means "no change". */
  readonly value: string;
}

export interface VariableAddition {
  readonly id: number;
  readonly name: string;
  readonly value: string;
}

export interface PathDraftItem {
  readonly id: number;
  readonly text: string;
}

export interface ZshDrafts {
  readonly variables: Readonly<Record<string, VariableDraft>>;
  readonly additions: readonly VariableAddition[];
  readonly path: readonly PathDraftItem[];
}

export const EMPTY_DRAFTS: ZshDrafts = { variables: {}, additions: [], path: [] };

/** The PATH list as drafts, starting from what the block holds. */
export function draftsFor(state: ZshEditState, firstId: number): ZshDrafts {
  return {
    ...EMPTY_DRAFTS,
    path: managedPath(state).map((text, index) => ({ id: firstId + index, text })),
  };
}

export interface ZshDraftProblems {
  readonly variables: Readonly<Record<string, string>>;
  readonly additions: Readonly<Record<number, string>>;
  readonly path: Readonly<Record<number, string>>;
}

export interface PathMark {
  /** The same item appears again in the managed list. */
  readonly duplicate: boolean;
  /** A static PATH item outside the block already holds this item (its line). */
  readonly outsideLine?: number;
}

export interface ZshDraftCheck {
  /** What would be sent; empty while any draft is wrong. */
  readonly edit?: ZshBlockEdit;
  readonly problems: ZshDraftProblems;
  readonly pathMarks: Readonly<Record<number, PathMark>>;
  readonly pathChanged: boolean;
  /** At least one change, and no problem anywhere. */
  readonly ready: boolean;
  readonly changeCount: number;
}

const NO_PROBLEMS: ZshDraftProblems = { variables: {}, additions: {}, path: {} };

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Static outside PATH items, normalized, with the line they are on. */
function outsideItems(state: ZshEditState): { item: string; line: number }[] {
  const items: { item: string; line: number }[] = [];
  for (const path of state.outside.path) {
    for (const segment of path.segments) {
      if (segment.state === "DYNAMIC") continue;
      const normalized = normalizePathItem(segment.text);
      if (normalized.ok) items.push({ item: normalized.item, line: path.line });
    }
  }
  return items;
}

export function checkDrafts(
  state: ZshEditState,
  drafts: ZshDrafts,
  t: TranslateFunction = zhTranslate,
): ZshDraftCheck {
  const variables = managedVariables(state);
  const edits: ZshVariableEdit[] = [];
  const variableProblems: Record<string, string> = {};
  const additionProblems: Record<number, string> = {};
  const pathProblems: Record<number, string> = {};

  for (const [name, draft] of Object.entries(drafts.variables)) {
    if (draft.mode === "keep") continue;
    const current = variables.find((candidate) => candidate.name === name);
    if (current === undefined) {
      variableProblems[name] = t("env.zshEdit.draft.variableMissing");
      continue;
    }
    const editability = variableEditability(current, t);
    if (!editability.ok) {
      variableProblems[name] = editability.reason;
      continue;
    }
    if (draft.mode === "remove") {
      edits.push({ op: "REMOVE", name });
      continue;
    }
    // A secret is replacement-only: an empty field leaves it as it is.
    if (current.secret ? draft.value === "" : draft.value === current.value) continue;
    const problem = valueProblem(draft.value, t);
    if (problem !== undefined) {
      variableProblems[name] = problem;
      continue;
    }
    edits.push({ op: "SET", name, value: draft.value });
  }

  const taken = new Set(variables.map((variable) => variable.name));
  const counts = new Map<string, number>();
  for (const addition of drafts.additions) {
    counts.set(addition.name, (counts.get(addition.name) ?? 0) + 1);
  }
  for (const addition of drafts.additions) {
    const problem =
      nameProblem(addition.name, t) ??
      (taken.has(addition.name)
        ? t("env.zshEdit.draft.additionTaken")
        : (counts.get(addition.name) ?? 0) > 1
          ? t("env.zshEdit.draft.duplicateName")
          : valueProblem(addition.value, t));
    if (problem !== undefined) {
      additionProblems[addition.id] = problem;
      continue;
    }
    edits.push({ op: "SET", name: addition.name, value: addition.value });
  }
  if (variables.length + drafts.additions.length - removedCount(drafts, variables) > MAX_ZSH_VARIABLES) {
    // Reported on the first addition so the field can show it.
    const first = drafts.additions[0];
    if (first !== undefined && additionProblems[first.id] === undefined) {
      additionProblems[first.id] = t("env.zshEdit.draft.maxVariables", { max: MAX_ZSH_VARIABLES });
    }
  }

  // PATH: the draft list as stored items, compared with what the block holds.
  const normalized: (string | undefined)[] = drafts.path.map((entry) => {
    const result = normalizePathItem(entry.text, t);
    if (!result.ok) {
      pathProblems[entry.id] = result.problem;
      return undefined;
    }
    return result.item;
  });
  if (drafts.path.length > MAX_ZSH_PATH_ITEMS) {
    const last = drafts.path[drafts.path.length - 1];
    if (last !== undefined && pathProblems[last.id] === undefined) {
      pathProblems[last.id] = t("env.zshEdit.draft.maxPath", { max: MAX_ZSH_PATH_ITEMS });
    }
  }
  const items = normalized.filter((item): item is string => item !== undefined);
  const occurrences = new Map<string, number>();
  for (const item of items) occurrences.set(item, (occurrences.get(item) ?? 0) + 1);
  const outside = outsideItems(state);
  const pathMarks: Record<number, PathMark> = {};
  drafts.path.forEach((entry, index) => {
    const item = normalized[index];
    if (item === undefined) return;
    const found = outside.find((candidate) => candidate.item === item);
    pathMarks[entry.id] = {
      duplicate: (occurrences.get(item) ?? 0) > 1,
      ...(found === undefined ? {} : { outsideLine: found.line }),
    };
  });
  const pathHasProblem = Object.keys(pathProblems).length > 0;
  const pathChanged = !pathHasProblem && !sameList(items, managedPath(state));

  const hasProblem =
    Object.keys(variableProblems).length > 0 ||
    Object.keys(additionProblems).length > 0 ||
    pathHasProblem;
  const problems: ZshDraftProblems = hasProblem
    ? { variables: variableProblems, additions: additionProblems, path: pathProblems }
    : NO_PROBLEMS;
  const changeCount = edits.length + (pathChanged ? 1 : 0);
  const edit: ZshBlockEdit | undefined =
    hasProblem || changeCount === 0
      ? undefined
      : { variables: edits, ...(pathChanged ? { path: items } : {}) };
  return {
    ...(edit === undefined ? {} : { edit }),
    problems,
    pathMarks,
    pathChanged,
    ready: edit !== undefined,
    changeCount,
  };
}

function removedCount(drafts: ZshDrafts, variables: readonly ZshEditVariable[]): number {
  return variables.filter((variable) => drafts.variables[variable.name]?.mode === "remove").length;
}

// ---- same-named assignments outside the block -----------------------------------------------

export interface OutsideConflict {
  readonly line: number;
  readonly beforeBlock: boolean;
  readonly text: string;
}

/** Assignments of the same name elsewhere in the file, with who wins. */
export function outsideConflicts(
  state: ZshEditState,
  name: string,
  t: TranslateFunction = zhTranslate,
): OutsideConflict[] {
  return state.outside.variables
    .filter((variable) => variable.name === name)
    .map((variable) => ({
      line: variable.line,
      beforeBlock: variable.beforeBlock,
      text: variable.beforeBlock
        ? t("env.zshEdit.outside.beforeBlock", { line: variable.line })
        : t("env.zshEdit.outside.afterBlock", { line: variable.line }),
    }));
}

// ---- wording ---------------------------------------------------------------------------------

/** Said after a successful save; nothing broader is ever claimed. */
export function zshEffectNote(t: TranslateFunction = zhTranslate): string {
  return t("env.zshEdit.note.effect");
}

export function pathFormNote(t: TranslateFunction = zhTranslate): string {
  return t("env.zshEdit.note.path");
}

export function valueFormNote(t: TranslateFunction = zhTranslate): string {
  return t("env.zshEdit.note.value");
}

const FILE_NAMES: Readonly<Record<ZshFileKey, string>> = {
  ZSHENV: ".zshenv",
  ZPROFILE: ".zprofile",
  ZSHRC: ".zshrc",
  ZLOGIN: ".zlogin",
};

export function startupFileName(file: ZshFileKey): string {
  return FILE_NAMES[file];
}

export interface FileImpact {
  readonly label: string;
  readonly detail: string;
  readonly order: string;
}

const IMPACT_KEYS: Record<ZshFileKey, MessageKey> = {
  ZSHENV: "env.zshEdit.impact.ZSHENV",
  ZPROFILE: "env.zshEdit.impact.ZPROFILE",
  ZSHRC: "env.zshEdit.impact.ZSHRC",
  ZLOGIN: "env.zshEdit.impact.ZLOGIN",
};

export function fileImpact(
  state: Pick<ZshEditState, "file" | "appliesTo" | "position">,
  t: TranslateFunction = zhTranslate,
): FileImpact {
  const applies = appliesToText(state.appliesTo, t);
  return {
    label: applies.label,
    detail: t("env.zshEdit.impact.detail", {
      applies: applies.detail,
      extra: t(IMPACT_KEYS[state.file]),
    }),
    order: t("env.zshEdit.impact.order", { position: state.position }),
  };
}

export function warningText(warning: ZshEditWarning, t: TranslateFunction = zhTranslate): string {
  switch (warning.kind) {
    case "OVERRIDES_EARLIER_ASSIGNMENT":
      return t("env.zshEdit.warning.overridesEarlier", { name: warning.name, line: warning.line });
    case "OVERRIDDEN_BY_LATER_ASSIGNMENT":
      return t("env.zshEdit.warning.overriddenByLater", { name: warning.name, line: warning.line });
    case "DUPLICATE_PATH_ITEM":
      return t("env.zshEdit.warning.duplicatePath", { item: warning.item });
    case "PATH_ITEM_ALSO_OUTSIDE":
      return t("env.zshEdit.warning.pathAlsoOutside", { item: warning.item, line: warning.line });
    case "DYNAMIC_PATH_OUTSIDE":
      return t("env.zshEdit.warning.dynamicPathOutside", { line: warning.line });
    case "LATER_PATH_ASSIGNMENT":
      return t("env.zshEdit.warning.laterPathAssignment", { line: warning.line });
    case "BLOCK_APPENDED":
      return t("env.zshEdit.warning.blockAppended");
    case "FILE_CREATED":
      return t("env.zshEdit.warning.fileCreated");
    case "SENSITIVE_VARIABLE":
      return t("env.zshEdit.warning.sensitiveVariable", { name: warning.name });
  }
}

export function previewKindText(
  preview: Pick<ZshEditPreview, "kind" | "createdBlock">,
  t: TranslateFunction = zhTranslate,
): string {
  if (preview.kind === "CREATE") return t("env.zshEdit.preview.create");
  return preview.createdBlock ? t("env.zshEdit.preview.append") : t("env.zshEdit.preview.modify");
}

export function notEnabledText(t: TranslateFunction = zhTranslate): string {
  return t("env.zshEdit.note.notEnabled");
}
