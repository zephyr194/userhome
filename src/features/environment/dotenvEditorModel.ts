import type { AppError } from "../../ipc/core";
import {
  MAX_EDIT_VALUE_CHARS,
  type EntryFlag,
  type EnvEditPreview,
  type EnvFileView,
  type EnvKeyEdit,
  type EnvRow,
  type ScanSettings,
} from "../../ipc/environment";
import type {
  FileState as WriteFileState,
  RecoveryPointKind,
  WriteKind,
  WriteStatus,
} from "../../ipc/resources";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { flagText } from "./environmentModel";
import { zhTranslate } from "./zhTranslate";

// The backend decides what can be written; everything here only mirrors its
// rules for early, per-field feedback. Secret values live in this state only
// while the user is editing: they are never stored in the browser, and the
// preview the backend returns carries none.

export type EntryRow = Extract<EnvRow, { kind: "ENTRY" }>;

// ---- secret names ----------------------------------------------------------

const SECRET_WORDS = ["TOKEN", "PASSWORD", "PASSWD", "SECRET", "CREDENTIAL", "PRIVATE_KEY"];
const SECRET_SEGMENTS = ["KEY", "PASS", "PWD", "AUTH"];

/** Mirrors the backend name heuristic; it errs on the side of masking. */
export function looksLikeSecretName(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    SECRET_WORDS.some((word) => upper.includes(word)) ||
    upper.endsWith("KEY") ||
    upper.split("_").some((segment) => SECRET_SEGMENTS.includes(segment))
  );
}

// ---- field checks ------------------------------------------------------------

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
// Control characters and invisible line/direction marks: a value containing
// one would not stay a single visible line.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;

export function keyProblem(key: string, t: TranslateFunction = zhTranslate): string | undefined {
  return KEY_PATTERN.test(key) ? undefined : t("env.dotEdit.key.pattern");
}

export function valueProblem(value: string, t: TranslateFunction = zhTranslate): string | undefined {
  if (FORBIDDEN_CHARACTERS.test(value)) return t("env.dotEdit.value.forbidden");
  if ([...value].length > MAX_EDIT_VALUE_CHARS) {
    return t("env.dotEdit.value.tooLong", { max: MAX_EDIT_VALUE_CHARS });
  }
  if (value.includes("'") && /["\\$`]/.test(value)) return t("env.dotEdit.value.quoteConflict");
  return undefined;
}

export type Editability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Entries the tool does not rewrite keep their bytes; this says why. */
export function entryEditability(row: EntryRow, t: TranslateFunction = zhTranslate): Editability {
  if (row.flags.length > 0) {
    const reasons = row.flags.map((flag: EntryFlag) => flagText(flag, t).label);
    return {
      ok: false,
      reason: t("env.dotEdit.entry.flagged", {
        flags: reasons.join(t("env.dotEdit.listSeparator")),
      }),
    };
  }
  if (row.quote === "DOUBLE" && row.value !== undefined && row.value.includes("\\")) {
    return { ok: false, reason: t("env.dotEdit.entry.backslash") };
  }
  if (!row.secret && row.hasValue && row.value === undefined) {
    return { ok: false, reason: t("env.dotEdit.entry.tooLong", { max: 4096 }) };
  }
  return { ok: true };
}

// ---- drafts -------------------------------------------------------------------

export type EntryMode = "keep" | "set" | "remove";

export interface EntryEdit {
  readonly mode: EntryMode;
  /** The new text; empty for a secret means "no change". */
  readonly value: string;
}

export interface Addition {
  readonly id: number;
  readonly key: string;
  readonly value: string;
  readonly exported: boolean;
}

export interface Drafts {
  readonly entryEdits: Readonly<Record<string, EntryEdit>>;
  readonly additions: readonly Addition[];
}

export const EMPTY_DRAFTS: Drafts = { entryEdits: {}, additions: [] };

export interface ExistingTarget {
  readonly kind: "existing";
  readonly grantId: string;
  readonly path: string;
  readonly settings: ScanSettings;
  readonly file: EnvFileView;
}

export interface NewTarget {
  readonly kind: "new";
  readonly grantId: string;
  readonly displayPath: string;
}

export type EditorTarget = ExistingTarget | NewTarget;

export interface DraftProblems {
  readonly entries: Readonly<Record<string, string>>;
  readonly additions: Readonly<Record<number, string>>;
}

export interface DraftCheck {
  readonly edits: readonly EnvKeyEdit[];
  readonly problems: DraftProblems;
  /** At least one edit, and no problem anywhere. */
  readonly ready: boolean;
}

function entryRows(target: EditorTarget): EntryRow[] {
  return target.kind === "existing"
    ? target.file.rows.filter((row): row is EntryRow => row.kind === "ENTRY")
    : [];
}

export function checkDrafts(
  target: EditorTarget,
  drafts: Drafts,
  t: TranslateFunction = zhTranslate,
): DraftCheck {
  const rows = entryRows(target);
  const edits: EnvKeyEdit[] = [];
  const entries: Record<string, string> = {};
  const additions: Record<number, string> = {};

  for (const [key, draft] of Object.entries(drafts.entryEdits)) {
    if (draft.mode === "keep") continue;
    const row = rows.find((candidate) => candidate.key === key);
    if (row === undefined) {
      entries[key] = t("env.dotEdit.draft.keyMissing");
      continue;
    }
    const editability = entryEditability(row, t);
    if (!editability.ok) {
      entries[key] = editability.reason;
      continue;
    }
    if (draft.mode === "remove") {
      edits.push({ op: "REMOVE", key });
      continue;
    }
    // A secret is replacement-only: an empty field leaves it as it is.
    if (row.secret ? draft.value === "" : draft.value === row.value) continue;
    const problem = valueProblem(draft.value, t);
    if (problem !== undefined) {
      entries[key] = problem;
      continue;
    }
    edits.push({ op: "SET", key, value: draft.value });
  }

  const taken = new Set(rows.map((row) => row.key));
  const counts = new Map<string, number>();
  for (const addition of drafts.additions) {
    counts.set(addition.key, (counts.get(addition.key) ?? 0) + 1);
  }
  for (const addition of drafts.additions) {
    const problem =
      addition.key === ""
        ? t("env.dotEdit.draft.keyEmpty")
        : (keyProblem(addition.key, t) ??
          (taken.has(addition.key)
            ? t("env.dotEdit.draft.keyExists")
            : (counts.get(addition.key) ?? 0) > 1
              ? t("env.dotEdit.draft.duplicateKey")
              : valueProblem(addition.value, t)));
    if (problem !== undefined) {
      additions[addition.id] = problem;
      continue;
    }
    edits.push({
      op: "ADD",
      key: addition.key,
      value: addition.value,
      ...(addition.exported ? { exported: true } : {}),
    });
  }

  const hasProblem =
    Object.keys(entries).length > 0 || Object.keys(additions).length > 0;
  return {
    // Nothing is sent while any draft is wrong.
    edits: hasProblem ? [] : edits,
    problems: { entries, additions },
    ready: !hasProblem && edits.length > 0,
  };
}

// ---- wording -------------------------------------------------------------------

export function previewHeadline(
  preview: Pick<EnvEditPreview, "kind">,
  t: TranslateFunction = zhTranslate,
): string {
  return preview.kind === "CREATE" ? t("env.dotEdit.preview.create") : t("env.dotEdit.preview.modify");
}

export function recoveryText(
  kind: WriteKind,
  recovery: RecoveryPointKind,
  t: TranslateFunction = zhTranslate,
): string {
  if (recovery === "BACKUP") return t("env.dotEdit.recovery.backup");
  if (recovery === "NONE_CREATED") {
    return kind === "CREATE" ? t("env.dotEdit.recovery.createdNone") : t("env.dotEdit.recovery.none");
  }
  return t("env.dotEdit.recovery.unavailable");
}

export interface SaveResult {
  readonly kind: WriteKind;
  readonly status: WriteStatus;
  readonly fileState: WriteFileState;
  readonly recoveryPoint: RecoveryPointKind;
  readonly backupId?: string;
  readonly errorMessage?: string;
}

export interface ResultText {
  readonly tone: "success" | "danger" | "warning";
  readonly headline: string;
  readonly detail?: string;
}

export function saveResultText(
  result: Omit<SaveResult, "errorMessage" | "backupId">,
  t: TranslateFunction = zhTranslate,
): ResultText {
  const created = result.kind === "CREATE";
  switch (result.fileState) {
    case "WRITTEN":
      return {
        tone: "success",
        headline: created ? t("env.dotEdit.result.createdWritten") : t("env.dotEdit.result.written"),
      };
    case "UNCHANGED":
      return { tone: "danger", headline: t("env.dotEdit.result.unchanged") };
    case "RESTORED":
      return { tone: "danger", headline: t("env.dotEdit.result.restored") };
    case "RESTORE_FAILED":
      return {
        tone: "danger",
        headline: t("env.dotEdit.result.restoreFailed"),
        detail: t("env.dotEdit.result.restoreFailedDetail"),
      };
    case "CREATED_REMOVED":
      return { tone: "danger", headline: t("env.dotEdit.result.createdRemoved") };
    case "CREATED_REMOVE_FAILED":
      return { tone: "danger", headline: t("env.dotEdit.result.createdRemoveFailed") };
    case "UNKNOWN":
      return { tone: "warning", headline: t("env.dotEdit.result.unknown") };
  }
}

/** Where editing may continue after a failed save without reloading. */
export function canResumeEditing(result: Pick<SaveResult, "fileState">): boolean {
  return (
    result.fileState === "UNCHANGED" ||
    result.fileState === "RESTORED" ||
    result.fileState === "CREATED_REMOVED"
  );
}

export interface EditorNotice {
  readonly tone: "error" | "warning" | "info";
  readonly text: string;
  /** The backend's own message, shown as secondary detail. */
  readonly detail?: string;
}

const FAILURE_KEYS: Partial<Record<AppError["code"], MessageKey>> = {
  TIMEOUT: "env.dotEdit.failure.TIMEOUT",
  CONFLICT: "env.dotEdit.failure.CONFLICT",
  NOT_FOUND: "env.dotEdit.failure.NOT_FOUND",
  PERMISSION_DENIED: "env.dotEdit.failure.PERMISSION_DENIED",
  VALIDATION_FAILED: "env.dotEdit.failure.VALIDATION_FAILED",
  INVALID_INPUT: "env.dotEdit.failure.INVALID_INPUT",
};

export function failureNotice(error: AppError, t: TranslateFunction = zhTranslate): EditorNotice {
  const key = FAILURE_KEYS[error.code] ?? "env.dotEdit.failure.default";
  return {
    tone: "error",
    text: t(key),
    detail: error.message,
  };
}

export function previewExpiredNotice(t: TranslateFunction = zhTranslate): EditorNotice {
  return {
    tone: "warning",
    text: t("env.dotEdit.failure.TIMEOUT"),
  };
}
