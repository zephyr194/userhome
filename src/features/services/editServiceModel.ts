import type { MessageKey, TranslateFunction } from "../../i18n";
import type { AppError } from "../../ipc/core";
import type {
  EditChangeKey,
  EditExecution,
  EditPreview,
  EditServiceRequest,
} from "../../ipc/servicesAdopt";
import type { LaunchdService } from "../../ipc/services";
import {
  hasErrors,
  isBlankEnvironmentRow,
  validateEditableFields,
  type ArgumentRow,
  type EnvironmentRow,
  type FormErrors,
} from "./createServiceModel";
import type { NoticeText } from "./adoptServiceModel";

/**
 * The structured edit of an adopted job: its form, the typed request built from
 * it (only what differs from the job as read), and the preview → save flow.
 * Validation and list editing are the create form's own, so the two cannot
 * drift apart.
 */

const CHANGE_LABELS: Record<EditChangeKey, MessageKey> = {
  ProgramArguments: "services.dialog.change.programArguments",
  WorkingDirectory: "services.dialog.change.workingDirectory",
  StandardOutPath: "services.dialog.change.stdoutPath",
  StandardErrorPath: "services.dialog.change.stderrPath",
  EnvironmentVariables: "services.dialog.change.environment",
  RunAtLoad: "services.dialog.change.runAtLoad",
  KeepAlive: "services.dialog.change.keepAlive",
};

export function changeLabel(change: EditChangeKey, t: TranslateFunction): string {
  return t(CHANGE_LABELS[change]);
}

export const KEEP_ALIVE_CONDITIONAL_NOTE = "services.dialog.note.keepAliveConditional" satisfies MessageKey;

/** What the job's plist says now, as far as discovery shows it. Values of environment variables are never known here. */
export interface EditOriginal {
  readonly label: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environmentKeys: readonly string[];
  readonly workingDirectory?: string;
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  readonly runAtLoad: boolean;
  readonly keepAlive: boolean;
  readonly keepAliveLocked: boolean;
}

export function editOriginalOf(service: LaunchdService): EditOriginal {
  const details = service.configFiles[0]?.details;
  const [executable = "", ...args] = details?.programArguments ?? [];
  return {
    label: service.label,
    executable,
    arguments: args,
    environmentKeys: details?.environmentKeys ?? [],
    ...(details?.standardOutPath === undefined
      ? {}
      : { stdoutPath: details.standardOutPath }),
    ...(details?.standardErrorPath === undefined
      ? {}
      : { stderrPath: details.standardErrorPath }),
    runAtLoad: details?.runAtLoad ?? false,
    keepAlive: details?.keepAlive?.mode === "ALWAYS",
    keepAliveLocked: details?.keepAlive?.mode === "CONDITIONAL",
  };
}

export interface EditFormState {
  readonly executable: string;
  readonly arguments: readonly ArgumentRow[];
  readonly workingDirectory: string;
  readonly clearWorkingDirectory: boolean;
  /** New or overwritten variables; values are typed here and never shown back. */
  readonly environment: readonly EnvironmentRow[];
  /** Existing variable names to remove. */
  readonly removedEnvironment: readonly string[];
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly runAtLoad: boolean;
  readonly keepAlive: boolean;
  readonly nextRowId: number;
}

export function initialEditForm(original: EditOriginal): EditFormState {
  return {
    executable: original.executable,
    arguments: original.arguments.map((value, index) => ({ id: index + 1, value })),
    workingDirectory: "",
    clearWorkingDirectory: false,
    environment: [],
    removedEnvironment: [],
    stdoutPath: original.stdoutPath ?? "",
    stderrPath: original.stderrPath ?? "",
    runAtLoad: original.runAtLoad,
    keepAlive: original.keepAlive,
    nextRowId: original.arguments.length + 1,
  };
}

/** Toggles whether an existing variable is removed; a removal never names a variable being set. */
export function toggleEnvironmentRemoval(state: EditFormState, name: string): EditFormState {
  const removed = state.removedEnvironment.includes(name)
    ? state.removedEnvironment.filter((item) => item !== name)
    : [...state.removedEnvironment, name];
  return { ...state, removedEnvironment: removed };
}

export type EditBuildResult =
  | { readonly ok: true; readonly request: EditServiceRequest }
  | { readonly ok: false; readonly errors: FormErrors };

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Values the job already has are the plist's own (discovery may show a home
 * path abbreviated), so the create rules check only what the user changed.
 */
function checkedChanges(errors: FormErrors, state: EditFormState, original: EditOriginal): FormErrors {
  const same = (value: string, before: string | undefined) => value.trim() === (before ?? "");
  return {
    ...errors,
    executable: same(state.executable, original.executable) ? undefined : errors.executable,
    arguments: sameList(state.arguments.map((row) => row.value), original.arguments)
      ? {}
      : errors.arguments,
    stdoutPath: same(state.stdoutPath, original.stdoutPath) ? undefined : errors.stdoutPath,
    stderrPath: same(state.stderrPath, original.stderrPath) ? undefined : errors.stderrPath,
  };
}

/** `undefined` leaves the key alone; `""` removes it; anything else sets it. */
function pathChange(value: string, original: string | undefined): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return original === undefined ? undefined : "";
  return trimmed === original ? undefined : trimmed;
}

/**
 * The typed edit request for the form, sending only what differs from the job
 * as it was read. Boolean switches go out only when flipped, because an absent
 * key and a `false` key are different to launchd.
 */
export function buildEditRequest(
  original: EditOriginal,
  state: EditFormState,
  t: TranslateFunction,
): EditBuildResult {
  const workingDirectory = state.clearWorkingDirectory ? "" : state.workingDirectory;
  const errors = checkedChanges(
    validateEditableFields({ ...state, workingDirectory }, t),
    state,
    original,
  );
  const keepAliveChanged = state.keepAlive !== original.keepAlive;
  if (keepAliveChanged && original.keepAliveLocked) {
    errors.general = errors.general ?? t(KEEP_ALIVE_CONDITIONAL_NOTE);
  }
  if (hasErrors(errors)) return { ok: false, errors };

  const executable = state.executable.trim();
  const argumentValues = state.arguments.map((row) => row.value);
  const environmentSet = Object.fromEntries(
    state.environment
      .filter((row) => !isBlankEnvironmentRow(row))
      .map((row) => [row.key.trim(), row.value]),
  );
  const setNames = new Set(Object.keys(environmentSet));
  const environmentRemove = state.removedEnvironment.filter((name) => !setNames.has(name));

  const trimmedDirectory = workingDirectory.trim();
  const request: EditServiceRequest = {
    domain: "GUI",
    label: original.label,
    ...(executable === original.executable ? {} : { executable }),
    ...(sameList(argumentValues, original.arguments) ? {} : { arguments: argumentValues }),
    ...(state.clearWorkingDirectory
      ? { workingDirectory: "" }
      : trimmedDirectory.length === 0
        ? {}
        : { workingDirectory: trimmedDirectory }),
    environmentSet,
    environmentRemove,
    ...(pathChange(state.stdoutPath, original.stdoutPath) === undefined
      ? {}
      : { stdoutPath: pathChange(state.stdoutPath, original.stdoutPath) }),
    ...(pathChange(state.stderrPath, original.stderrPath) === undefined
      ? {}
      : { stderrPath: pathChange(state.stderrPath, original.stderrPath) }),
    ...(state.runAtLoad === original.runAtLoad ? {} : { runAtLoad: state.runAtLoad }),
    ...(keepAliveChanged ? { keepAlive: state.keepAlive } : {}),
  };
  const changes =
    request.executable !== undefined ||
    request.arguments !== undefined ||
    request.workingDirectory !== undefined ||
    request.stdoutPath !== undefined ||
    request.stderrPath !== undefined ||
    request.runAtLoad !== undefined ||
    request.keepAlive !== undefined ||
    Object.keys(environmentSet).length > 0 ||
    environmentRemove.length > 0;
  if (!changes) {
    return { ok: false, errors: { ...errors, general: t("services.dialog.edit.noChanges") } };
  }
  return { ok: true, request };
}

// ---- the edit flow --------------------------------------------------------

export type EditDialogState =
  | { readonly phase: "editing"; readonly error?: AppError }
  | { readonly phase: "previewing" }
  | { readonly phase: "preview"; readonly preview: EditPreview }
  | { readonly phase: "saving"; readonly preview: EditPreview }
  | { readonly phase: "done"; readonly execution: EditExecution }
  | {
      readonly phase: "failed";
      readonly preview: EditPreview;
      /** The confirmation ran but did not leave the file in a known state. */
      readonly execution?: EditExecution;
      /** The confirmation was refused; nothing was written. */
      readonly error?: AppError;
    };

export type EditDialogAction =
  | { readonly type: "previewRequested" }
  | { readonly type: "previewLoaded"; readonly preview: EditPreview }
  | { readonly type: "previewFailed"; readonly error: AppError }
  | { readonly type: "editRequested" }
  | { readonly type: "saveRequested" }
  | { readonly type: "saveFinished"; readonly execution: EditExecution }
  | { readonly type: "saveFailed"; readonly error: AppError };

export const INITIAL_EDIT_DIALOG: EditDialogState = { phase: "editing" };

export function wasSaved(execution: EditExecution): boolean {
  return execution.outcome.status === "SUCCEEDED";
}

export function editDialogReducer(
  state: EditDialogState,
  action: EditDialogAction,
): EditDialogState {
  switch (action.type) {
    case "previewRequested":
      return state.phase === "editing" ? { phase: "previewing" } : state;
    case "previewLoaded":
      return state.phase === "previewing"
        ? { phase: "preview", preview: action.preview }
        : state;
    case "previewFailed":
      return state.phase === "previewing"
        ? { phase: "editing", error: action.error }
        : state;
    case "editRequested":
      return state.phase === "preview" || state.phase === "failed"
        ? { phase: "editing" }
        : state;
    case "saveRequested":
      return state.phase === "preview"
        ? { phase: "saving", preview: state.preview }
        : state;
    case "saveFinished":
      if (state.phase !== "saving") return state;
      return wasSaved(action.execution)
        ? { phase: "done", execution: action.execution }
        : { phase: "failed", preview: state.preview, execution: action.execution };
    case "saveFailed":
      return state.phase === "saving"
        ? { phase: "failed", preview: state.preview, error: action.error }
        : state;
  }
}

/** The preview whose grant and operation must be given up when the user walks away. */
export function discardTarget(state: EditDialogState): string | undefined {
  if (state.phase === "preview") return state.preview.operationId;
  if (state.phase === "failed" && state.execution === undefined) {
    return state.preview.operationId;
  }
  return undefined;
}

const FILE_STATE_TEXT: Record<string, MessageKey> = {
  RESTORED: "services.dialog.edit.fileState.restored",
  RESTORE_FAILED: "services.dialog.edit.fileState.restoreFailed",
  UNCHANGED: "services.dialog.edit.fileState.unchanged",
  UNKNOWN: "services.dialog.edit.fileState.unknown",
};

export function describeEditFailure(error: AppError, t: TranslateFunction): NoticeText {
  if (error.code === "CONFLICT") {
    return {
      title: t("services.dialog.edit.conflict.title"),
      detail: t("services.dialog.edit.conflict.detail"),
    };
  }
  return { title: t("services.dialog.edit.failure.title"), detail: error.message };
}

export function describeEditOutcome(execution: EditExecution, t: TranslateFunction): NoticeText {
  if (wasSaved(execution)) {
    return {
      title: t("services.dialog.edit.saved.title", { path: execution.filePath }),
      detail: execution.reloadNote,
    };
  }
  if (execution.outcome.error?.code === "CONFLICT") {
    return {
      title: t("services.dialog.edit.conflict.title"),
      detail: t("services.dialog.edit.conflict.detail"),
    };
  }
  return {
    title: t("services.dialog.edit.outcome.failedTitle"),
    detail: t(FILE_STATE_TEXT[execution.outcome.fileState] ?? "services.dialog.edit.fileState.fallback"),
  };
}

/** A grant that could not be revoked is reported beside a result that stands. */
export function grantNotice(execution: EditExecution, t: TranslateFunction): string | undefined {
  const error = execution.grantReleaseError;
  return error === undefined
    ? undefined
    : t("services.dialog.edit.grantRevokeFailed", { message: error.message });
}
