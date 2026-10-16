import { decodeAppError } from "../../ipc/core";
import type {
  ZshBlockEdit,
  ZshEditEnabled,
  ZshEditExecution,
  ZshEditOutcome,
  ZshEditPreview,
  ZshEditState,
  ZshEditTarget,
} from "../../ipc/environment";
import {
  PREVIEW_EXPIRED_NOTICE,
  canResumeEditing,
  failureNotice,
  type EditorNotice,
  type SaveResult,
} from "./dotenvEditorModel";
import {
  EMPTY_DRAFTS,
  checkDrafts,
  draftsFor,
  managedVariables,
  type VariableAddition,
  type VariableMode,
  type ZshDraftCheck,
  type ZshDrafts,
} from "./zshEditorModel";

export type ZshEditorPhase =
  | "closed"
  | "loading"
  | "editing"
  | "enabling"
  | "previewing"
  | "previewed"
  | "saving"
  | "saved";

/** Why the file cannot be edited at all (nothing could be read, or it is out of reach). */
export interface LoadProblem {
  readonly kind: "UNAVAILABLE" | "OUTSIDE_HOME" | "NOT_LOCATED" | "ERROR";
  readonly message: string;
}

export interface ZshEditorState {
  readonly phase: ZshEditorPhase;
  readonly target?: ZshEditTarget;
  /** The file as it was read; the preview is bound to its content hash. */
  readonly loaded?: ZshEditState;
  readonly problem?: LoadProblem;
  readonly drafts: ZshDrafts;
  readonly nextId: number;
  readonly notice?: EditorNotice;
  readonly preview?: ZshEditPreview;
  readonly result?: SaveResult;
}

const CLOSED: ZshEditorState = {
  phase: "closed",
  drafts: EMPTY_DRAFTS,
  nextId: 1,
};

export interface ZshEditorDeps {
  load: (target: ZshEditTarget) => Promise<ZshEditOutcome>;
  enable: (target: ZshEditTarget) => Promise<ZshEditEnabled>;
  /** Revokes the authorization of the file (the ordinary grant revocation). */
  revoke: (grantId: string) => Promise<void>;
  preview: (
    target: ZshEditTarget,
    expectedHash: string | undefined,
    edit: ZshBlockEdit,
  ) => Promise<ZshEditPreview>;
  execute: (target: ZshEditTarget, operationId: string) => Promise<ZshEditExecution>;
  /** Called after a transaction ran, so the page can reload the overview. */
  onSaved?: (target: ZshEditTarget) => void;
}

export interface ZshEditorController {
  getState: () => ZshEditorState;
  subscribe: (listener: () => void) => () => void;
  /** The current drafts as an edit and per-field problems (while a file is loaded). */
  check: () => ZshDraftCheck | undefined;
  open: (target: ZshEditTarget) => Promise<void>;
  /** Reads the file again; unsaved drafts are dropped. */
  reload: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setVariableMode: (name: string, mode: VariableMode) => void;
  setVariableValue: (name: string, value: string) => void;
  addVariable: () => void;
  updateVariable: (id: number, patch: Partial<Omit<VariableAddition, "id">>) => void;
  removeVariable: (id: number) => void;
  addPathItem: () => void;
  updatePathItem: (id: number, text: string) => void;
  removePathItem: (id: number) => void;
  /** Moves an item one place up (-1) or down (1); the keyboard-reachable way to sort. */
  movePathItem: (id: number, direction: -1 | 1) => void;
  requestPreview: () => Promise<void>;
  cancelPreview: () => void;
  confirm: () => Promise<void>;
  resumeEditing: () => void;
  close: () => void;
  /** Drops a preview whose deadline has passed (called from a timer). */
  checkExpiry: (nowMs: number) => void;
  /** Replaces the callback run after a transaction ran. */
  setOnSaved: (onSaved: ((target: ZshEditTarget) => void) | undefined) => void;
}

/**
 * Framework-free state machine behind the zsh block editor. Nothing is
 * written until `confirm`, which the UI reaches only from a shown preview;
 * drafts (which may hold secret text) live only here and are dropped on save,
 * close, reopen and reload. Loads, previews and writes are single-flight, and an
 * answer for an earlier request never replaces the current state.
 */
export function createZshEditorController(deps: ZshEditorDeps): ZshEditorController {
  let state: ZshEditorState = CLOSED;
  let ticket = 0;
  let onSaved = deps.onSaved;
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function update(patch: Partial<ZshEditorState>) {
    state = { ...state, ...patch };
    notify();
  }

  const phaseIs = (phase: ZshEditorPhase) => state.phase === phase;
  const editing = () => phaseIs("editing") && state.loaded !== undefined;
  const busy = () =>
    state.phase === "loading" ||
    state.phase === "enabling" ||
    state.phase === "previewing" ||
    state.phase === "saving";

  function check(): ZshDraftCheck | undefined {
    return state.loaded === undefined ? undefined : checkDrafts(state.loaded, state.drafts);
  }

  function problemOf(outcome: Exclude<ZshEditOutcome, { status: "READY" }>): LoadProblem {
    return { kind: outcome.status, message: outcome.message };
  }

  /** Reads the file and applies the answer unless something newer happened. */
  async function load(keepDrafts: boolean): Promise<void> {
    const target = state.target;
    if (target === undefined) return;
    const mine = ++ticket;
    const previous = state.loaded;
    const previousDrafts = state.drafts;
    const previousNextId = state.nextId;
    update({ phase: "loading", notice: undefined });
    let outcome: ZshEditOutcome;
    try {
      outcome = await deps.load(target);
    } catch (error) {
      if (mine === ticket && phaseIs("loading")) {
        update({
          phase: "editing",
          loaded: undefined,
          problem: { kind: "ERROR", message: decodeAppError(error).message },
        });
      }
      return;
    }
    if (mine !== ticket || !phaseIs("loading")) return;
    if (outcome.status !== "READY") {
      update({
        phase: "editing",
        loaded: undefined,
        problem: problemOf(outcome),
        drafts: EMPTY_DRAFTS,
      });
      return;
    }
    const loaded: ZshEditState = outcome;
    const unchanged =
      keepDrafts &&
      previous !== undefined &&
      previous.contentHash === loaded.contentHash &&
      previous.block.status === loaded.block.status;
    if (unchanged) {
      update({
        phase: "editing",
        loaded,
        problem: undefined,
        drafts: previousDrafts,
        nextId: previousNextId,
      });
      return;
    }
    const drafts = draftsFor(loaded, previousNextId);
    update({
      phase: "editing",
      loaded,
      problem: undefined,
      drafts,
      nextId: previousNextId + drafts.path.length,
      ...(keepDrafts && previous !== undefined
        ? {
            notice: {
              tone: "warning" as const,
              text: "文件在你查看之后发生了变化，已重新读取并放弃未保存的改动。",
            },
          }
        : {}),
    });
  }

  async function open(target: ZshEditTarget): Promise<void> {
    if (busy()) return;
    state = { ...CLOSED, phase: "loading", target, nextId: state.nextId };
    notify();
    await load(false);
  }

  async function reload(): Promise<void> {
    if (state.target === undefined || !phaseIs("editing")) return;
    await load(false);
  }

  async function enable(): Promise<void> {
    const { target, loaded } = state;
    if (!phaseIs("editing") || target === undefined || loaded === undefined || loaded.enabled) {
      return;
    }
    const mine = ++ticket;
    update({ phase: "enabling", notice: undefined });
    try {
      await deps.enable(target);
    } catch (error) {
      if (mine === ticket && phaseIs("enabling")) {
        update({ phase: "editing", notice: failureNotice(decodeAppError(error)) });
      }
      return;
    }
    if (mine !== ticket || !phaseIs("enabling")) return;
    await load(true);
  }

  async function disable(): Promise<void> {
    const { loaded } = state;
    if (!phaseIs("editing") || loaded?.grantId === undefined) return;
    const mine = ++ticket;
    const grantId = loaded.grantId;
    update({ phase: "enabling", notice: undefined });
    try {
      await deps.revoke(grantId);
    } catch (error) {
      if (mine === ticket && phaseIs("enabling")) {
        update({ phase: "editing", notice: failureNotice(decodeAppError(error)) });
      }
      return;
    }
    if (mine !== ticket || !phaseIs("enabling")) return;
    await load(true);
  }

  function prefill(name: string): string {
    const current = state.loaded === undefined ? undefined : managedVariables(state.loaded).find(
      (candidate) => candidate.name === name,
    );
    return current !== undefined && !current.secret ? (current.value ?? "") : "";
  }

  function setVariableMode(name: string, mode: VariableMode) {
    if (!editing()) return;
    const { [name]: previous, ...rest } = state.drafts.variables;
    update({
      drafts: {
        ...state.drafts,
        variables:
          mode === "keep"
            ? rest
            : {
                ...rest,
                [name]: {
                  mode,
                  value: mode === "set" ? (previous?.value ?? prefill(name)) : "",
                },
              },
      },
      notice: undefined,
    });
  }

  function setVariableValue(name: string, value: string) {
    if (!editing()) return;
    update({
      drafts: {
        ...state.drafts,
        variables: { ...state.drafts.variables, [name]: { mode: "set", value } },
      },
      notice: undefined,
    });
  }

  function addVariable() {
    if (!editing()) return;
    update({
      drafts: {
        ...state.drafts,
        additions: [...state.drafts.additions, { id: state.nextId, name: "", value: "" }],
      },
      nextId: state.nextId + 1,
      notice: undefined,
    });
  }

  function updateVariable(id: number, patch: Partial<Omit<VariableAddition, "id">>) {
    if (!editing()) return;
    update({
      drafts: {
        ...state.drafts,
        additions: state.drafts.additions.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      },
      notice: undefined,
    });
  }

  function removeVariable(id: number) {
    if (!editing()) return;
    update({
      drafts: {
        ...state.drafts,
        additions: state.drafts.additions.filter((row) => row.id !== id),
      },
    });
  }

  function addPathItem() {
    if (!editing()) return;
    update({
      drafts: { ...state.drafts, path: [...state.drafts.path, { id: state.nextId, text: "" }] },
      nextId: state.nextId + 1,
      notice: undefined,
    });
  }

  function updatePathItem(id: number, text: string) {
    if (!editing()) return;
    update({
      drafts: {
        ...state.drafts,
        path: state.drafts.path.map((item) => (item.id === id ? { ...item, text } : item)),
      },
      notice: undefined,
    });
  }

  function removePathItem(id: number) {
    if (!editing()) return;
    update({
      drafts: { ...state.drafts, path: state.drafts.path.filter((item) => item.id !== id) },
      notice: undefined,
    });
  }

  function movePathItem(id: number, direction: -1 | 1) {
    if (!editing()) return;
    const items = [...state.drafts.path];
    const from = items.findIndex((item) => item.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= items.length) return;
    const moved = items[from];
    const other = items[to];
    if (moved === undefined || other === undefined) return;
    items[from] = other;
    items[to] = moved;
    update({ drafts: { ...state.drafts, path: items }, notice: undefined });
  }

  async function requestPreview(): Promise<void> {
    const { target, loaded } = state;
    const drafts = check();
    if (!editing() || target === undefined || loaded === undefined) return;
    if (drafts?.ready !== true || drafts.edit === undefined) return;
    const mine = ++ticket;
    update({ phase: "previewing", notice: undefined });
    try {
      const preview = await deps.preview(target, loaded.contentHash, drafts.edit);
      if (mine === ticket && phaseIs("previewing")) {
        update({ phase: "previewed", preview });
      }
    } catch (error) {
      if (mine === ticket && phaseIs("previewing")) {
        update({ phase: "editing", notice: failureNotice(decodeAppError(error)) });
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
    if (state.phase !== "previewed" || preview === undefined || target === undefined) return;
    const mine = ++ticket;
    update({ phase: "saving" });
    let execution: ZshEditExecution;
    try {
      execution = await deps.execute(target, preview.operationId);
    } catch (error) {
      // A refused confirmation changed nothing; the preview is spent.
      if (mine === ticket && phaseIs("saving")) {
        update({
          phase: "editing",
          preview: undefined,
          notice: failureNotice(decodeAppError(error)),
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
        ? { drafts: EMPTY_DRAFTS, notice: undefined }
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
    if (busy()) return;
    ticket += 1;
    state = { ...CLOSED, nextId: state.nextId };
    notify();
  }

  function checkExpiry(nowMs: number) {
    if (state.phase !== "previewed" || state.preview === undefined) return;
    const deadline = Date.parse(state.preview.expiresAt);
    if (Number.isFinite(deadline) && nowMs >= deadline) {
      ticket += 1;
      update({ phase: "editing", preview: undefined, notice: PREVIEW_EXPIRED_NOTICE });
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
    open,
    reload,
    enable,
    disable,
    setVariableMode,
    setVariableValue,
    addVariable,
    updateVariable,
    removeVariable,
    addPathItem,
    updatePathItem,
    removePathItem,
    movePathItem,
    requestPreview,
    cancelPreview,
    confirm,
    resumeEditing,
    close,
    checkExpiry,
    setOnSaved(next) {
      onSaved = next;
    },
  };
}
