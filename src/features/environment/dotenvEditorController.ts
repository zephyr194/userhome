import { decodeAppError } from "../../ipc/core";
import type { EnvEditPreview, EnvKeyEdit } from "../../ipc/environment";
import type { ResourceWriteExecution } from "../../ipc/resources";
import type { TranslateFunction } from "../../i18n";
import {
  EMPTY_DRAFTS,
  canResumeEditing,
  checkDrafts,
  failureNotice,
  previewExpiredNotice,
  type Addition,
  type DraftCheck,
  type EditorNotice,
  type EditorTarget,
  type EntryEdit,
  type EntryMode,
  type ExistingTarget,
  type NewTarget,
  type SaveResult,
} from "./dotenvEditorModel";
import { zhTranslate } from "./zhTranslate";

export type EditorPhase =
  | "closed"
  | "editing"
  | "previewing"
  | "previewed"
  | "saving"
  | "saved";

export interface EditorState {
  readonly phase: EditorPhase;
  readonly target?: EditorTarget;
  readonly entryEdits: Readonly<Record<string, EntryEdit>>;
  readonly additions: readonly Addition[];
  readonly nextId: number;
  readonly notice?: EditorNotice;
  readonly preview?: EnvEditPreview;
  readonly result?: SaveResult;
}

const CLOSED: EditorState = {
  phase: "closed",
  ...EMPTY_DRAFTS,
  nextId: 1,
};

export interface DotenvEditorDeps {
  preview: (
    target: EditorTarget,
    edits: readonly EnvKeyEdit[],
  ) => Promise<EnvEditPreview>;
  execute: (
    target: EditorTarget,
    operationId: string,
  ) => Promise<ResourceWriteExecution>;
  /** Called after a transaction ran, so the page can reload the file. */
  onSaved?: (target: EditorTarget) => void;
  t?: TranslateFunction;
}

export interface DotenvEditorController {
  getState: () => EditorState;
  subscribe: (listener: () => void) => () => void;
  /** The current drafts as edits and per-field problems (while open). */
  check: () => DraftCheck | undefined;
  openExisting: (input: Omit<ExistingTarget, "kind">) => void;
  openNew: (input: Omit<NewTarget, "kind">) => void;
  setEntryMode: (key: string, mode: EntryMode) => void;
  setEntryValue: (key: string, value: string) => void;
  addRow: () => void;
  updateRow: (id: number, patch: Partial<Omit<Addition, "id">>) => void;
  removeRow: (id: number) => void;
  requestPreview: () => Promise<void>;
  cancelPreview: () => void;
  confirm: () => Promise<void>;
  resumeEditing: () => void;
  close: () => void;
  /** Drops a preview whose deadline has passed (called from a timer). */
  checkExpiry: (nowMs: number) => void;
  /** Replaces the callback run after a transaction ran. */
  setOnSaved: (onSaved: ((target: EditorTarget) => void) | undefined) => void;
  setTranslate: (next: TranslateFunction) => void;
}

/**
 * Framework-free state machine behind the dotenv editor. Nothing is written
 * until `confirm`, which the UI reaches only from a shown preview; drafts
 * (which may hold secret text) live only here and are dropped on save, close
 * and reopen. Writes and previews are single-flight, and an answer for an
 * earlier request never replaces the current state.
 */
export function createDotenvEditorController(
  deps: DotenvEditorDeps,
): DotenvEditorController {
  let state: EditorState = CLOSED;
  let ticket = 0;
  let onSaved = deps.onSaved;
  let t: TranslateFunction = deps.t ?? zhTranslate;
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function update(patch: Partial<EditorState>) {
    state = { ...state, ...patch };
    notify();
  }

  function open(target: EditorTarget) {
    if (state.phase === "previewing" || state.phase === "saving") return;
    ticket += 1;
    state = { ...CLOSED, phase: "editing", target };
    notify();
  }

  const phaseIs = (phase: EditorPhase) => state.phase === phase;
  const editing = () => phaseIs("editing");

  function check(): DraftCheck | undefined {
    return state.target === undefined
      ? undefined
      : checkDrafts(
          state.target,
          {
            entryEdits: state.entryEdits,
            additions: state.additions,
          },
          t,
        );
  }

  function prefill(key: string): string {
    if (state.target?.kind !== "existing") return "";
    const row = state.target.file.rows.find(
      (candidate) => candidate.kind === "ENTRY" && candidate.key === key,
    );
    return row?.kind === "ENTRY" && !row.secret ? (row.value ?? "") : "";
  }

  function setEntryMode(key: string, mode: EntryMode) {
    if (!editing()) return;
    const { [key]: previous, ...rest } = state.entryEdits;
    if (mode === "keep") {
      update({ entryEdits: rest, notice: undefined });
    } else {
      update({
        entryEdits: {
          ...rest,
          [key]: {
            mode,
            value: mode === "set" ? (previous?.value ?? prefill(key)) : "",
          },
        },
        notice: undefined,
      });
    }
  }

  function setEntryValue(key: string, value: string) {
    if (!editing()) return;
    update({
      entryEdits: { ...state.entryEdits, [key]: { mode: "set", value } },
      notice: undefined,
    });
  }

  function addRow() {
    if (!editing()) return;
    update({
      additions: [
        ...state.additions,
        { id: state.nextId, key: "", value: "", exported: false },
      ],
      nextId: state.nextId + 1,
      notice: undefined,
    });
  }

  function updateRow(id: number, patch: Partial<Omit<Addition, "id">>) {
    if (!editing()) return;
    update({
      additions: state.additions.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
      notice: undefined,
    });
  }

  function removeRow(id: number) {
    if (!editing()) return;
    update({ additions: state.additions.filter((row) => row.id !== id) });
  }

  async function requestPreview(): Promise<void> {
    const target = state.target;
    const drafts = check();
    if (!editing() || target === undefined || !drafts?.ready) return;
    const mine = ++ticket;
    update({ phase: "previewing", notice: undefined });
    try {
      const preview = await deps.preview(target, drafts.edits);
      if (mine === ticket && phaseIs("previewing")) {
        update({ phase: "previewed", preview });
      }
    } catch (error) {
      if (mine === ticket && phaseIs("previewing")) {
        update({ phase: "editing", notice: failureNotice(decodeAppError(error), t) });
      }
    }
  }

  function cancelPreview() {
    if (state.phase === "previewed") {
      ticket += 1;
      update({ phase: "editing", preview: undefined });
    }
  }

  async function confirm(): Promise<void> {
    const { preview, target } = state;
    if (state.phase !== "previewed" || preview === undefined || target === undefined) {
      return;
    }
    const mine = ++ticket;
    update({ phase: "saving" });
    let execution: ResourceWriteExecution;
    try {
      execution = await deps.execute(target, preview.operationId);
    } catch (error) {
      // A refused confirmation changed nothing; the preview is spent.
      if (mine === ticket && phaseIs("saving")) {
        update({
          phase: "editing",
          preview: undefined,
          notice: failureNotice(decodeAppError(error), t),
        });
      }
      return;
    }
    if (mine !== ticket || !phaseIs("saving")) return;
    const { outcome } = execution;
    const result: SaveResult = {
      kind: outcome.kind,
      status: outcome.status,
      fileState: outcome.fileState,
      recoveryPoint: outcome.recoveryPoint,
      ...(outcome.backupId === undefined ? {} : { backupId: outcome.backupId }),
      ...(outcome.error === undefined ? {} : { errorMessage: outcome.error.message }),
    };
    update({
      phase: "saved",
      preview: undefined,
      result,
      // Secret text must not outlive a successful write.
      ...(outcome.status === "SUCCEEDED"
        ? { ...EMPTY_DRAFTS, notice: undefined }
        : {}),
    });
    onSaved?.(target);
  }

  function resumeEditing() {
    if (
      state.phase === "saved" &&
      state.result !== undefined &&
      state.result.status === "FAILED" &&
      canResumeEditing(state.result)
    ) {
      update({ phase: "editing", result: undefined });
    }
  }

  function close() {
    if (state.phase === "previewing" || state.phase === "saving") return;
    ticket += 1;
    state = CLOSED;
    notify();
  }

  function checkExpiry(nowMs: number) {
    if (state.phase !== "previewed" || state.preview === undefined) return;
    const deadline = Date.parse(state.preview.expiresAt);
    if (Number.isFinite(deadline) && nowMs >= deadline) {
      ticket += 1;
      update({
        phase: "editing",
        preview: undefined,
        notice: previewExpiredNotice(t),
      });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    openExisting: (input) => open({ kind: "existing", ...input }),
    openNew: (input) => open({ kind: "new", ...input }),
    setEntryMode,
    setEntryValue,
    addRow,
    updateRow,
    removeRow,
    requestPreview,
    cancelPreview,
    confirm,
    resumeEditing,
    close,
    checkExpiry,
    setOnSaved(next) {
      onSaved = next;
    },
    setTranslate(next) {
      t = next;
    },
  };
}
