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
import { flagText } from "./environmentModel";

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

export function keyProblem(key: string): string | undefined {
  return KEY_PATTERN.test(key)
    ? undefined
    : "键名必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 255 个字符。";
}

export function valueProblem(value: string): string | undefined {
  if (FORBIDDEN_CHARACTERS.test(value)) {
    return "值含换行、制表符或其他控制 / 不可见方向字符，不能安全写成单行值。";
  }
  if ([...value].length > MAX_EDIT_VALUE_CHARS) {
    return `值超过 ${MAX_EDIT_VALUE_CHARS} 个字符。`;
  }
  if (value.includes("'") && /["\\$`]/.test(value)) {
    return "值同时含单引号与 $、反引号、反斜杠或双引号，无法在不引入转义或插值的前提下写入。";
  }
  return undefined;
}

export type Editability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Entries the tool does not rewrite keep their bytes; this says why. */
export function entryEditability(row: EntryRow): Editability {
  if (row.flags.length > 0) {
    const reasons = row.flags.map((flag: EntryFlag) => flagText(flag).label);
    return {
      ok: false,
      reason: `${reasons.join("、")}：保持原样，不在此修改或删除；请在编辑器中手动处理。`,
    };
  }
  if (row.quote === "DOUBLE" && row.value !== undefined && row.value.includes("\\")) {
    return {
      ok: false,
      reason: "双引号值含反斜杠转义：本工具不解码转义，为避免改变含义，不在此修改。",
    };
  }
  if (!row.secret && row.hasValue && row.value === undefined) {
    return { ok: false, reason: "值过长（超过 4096 个字符），不在此修改。" };
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

export function checkDrafts(target: EditorTarget, drafts: Drafts): DraftCheck {
  const rows = entryRows(target);
  const edits: EnvKeyEdit[] = [];
  const entries: Record<string, string> = {};
  const additions: Record<number, string> = {};

  for (const [key, draft] of Object.entries(drafts.entryEdits)) {
    if (draft.mode === "keep") continue;
    const row = rows.find((candidate) => candidate.key === key);
    if (row === undefined) {
      entries[key] = "文件中没有这个键，请重新加载文件。";
      continue;
    }
    const editability = entryEditability(row);
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
    const problem = valueProblem(draft.value);
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
        ? "请填写键名。"
        : (keyProblem(addition.key) ??
          (taken.has(addition.key)
            ? "该键已存在，请直接修改它。"
            : (counts.get(addition.key) ?? 0) > 1
              ? "键名重复，一次保存里同一个键只能出现一次。"
              : valueProblem(addition.value)));
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

export function previewHeadline(preview: Pick<EnvEditPreview, "kind">): string {
  return preview.kind === "CREATE" ? "将创建新文件" : "将修改现有文件";
}

export function recoveryText(kind: WriteKind, recovery: RecoveryPointKind): string {
  if (recovery === "BACKUP") return "写入前会先备份当前内容，校验失败时自动恢复。";
  if (recovery === "NONE_CREATED") {
    return kind === "CREATE"
      ? "新文件没有恢复点：此前没有内容可备份，也不会伪造备份。校验失败时会移除该新文件。"
      : "没有恢复点。";
  }
  return "无法建立备份，因此不会写入。";
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

export function saveResultText(result: Omit<SaveResult, "errorMessage" | "backupId">): ResultText {
  const created = result.kind === "CREATE";
  switch (result.fileState) {
    case "WRITTEN":
      return {
        tone: "success",
        headline: created
          ? "已创建并通过读回校验（新文件，无恢复点）。"
          : "已保存并通过读回校验；原内容保存在备份中。",
      };
    case "UNCHANGED":
      return { tone: "danger", headline: "保存失败，文件未改动。" };
    case "RESTORED":
      return {
        tone: "danger",
        headline: "写入后的读回校验未通过，已恢复为原内容并核对。",
      };
    case "RESTORE_FAILED":
      return {
        tone: "danger",
        headline: "读回校验未通过，且未能确认已恢复；文件可能含有新内容。",
        detail: "请先查看文件；备份仍保存着写入前的内容。",
      };
    case "CREATED_REMOVED":
      return { tone: "danger", headline: "新文件未通过读回校验，已移除。" };
    case "CREATED_REMOVE_FAILED":
      return {
        tone: "danger",
        headline: "新文件未通过读回校验，且未能移除；它可能仍存在。",
      };
    case "UNKNOWN":
      return { tone: "warning", headline: "无法确认文件的当前内容，请重新加载后查看。" };
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

const FAILURE_TEXT: Partial<Record<AppError["code"], string>> = {
  TIMEOUT: "预览已过期，没有写入任何内容。请重新预览。",
  CONFLICT: "文件、授权或预览已变化，没有写入任何内容。请重新加载文件后再预览。",
  NOT_FOUND: "文件或授权已不存在，没有写入任何内容。",
  PERMISSION_DENIED: "没有权限，或授权已失效，没有写入任何内容。",
  VALIDATION_FAILED: "这次改动无法安全保存，没有写入任何内容。",
  INVALID_INPUT: "输入不符合要求，没有写入任何内容。",
};

export function failureNotice(error: AppError): EditorNotice {
  return {
    tone: "error",
    text: FAILURE_TEXT[error.code] ?? "保存未完成，没有确认写入任何内容。",
    detail: error.message,
  };
}

export const PREVIEW_EXPIRED_NOTICE: EditorNotice = {
  tone: "warning",
  text: "预览已过期，没有写入任何内容。请重新预览。",
};
