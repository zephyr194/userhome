import type { MessageKey, TranslateFunction } from "../../i18n";
import type { AppError } from "../../ipc/core";
import {
  CREATE_SERVICE_LIMITS,
  CREATE_SERVICE_NAMESPACE,
  hasForbiddenTextCharacters,
  type CreateServiceExecution,
  type CreateServicePreview,
  type CreateServiceRequest,
} from "../../ipc/services";

/**
 * Pure logic of the "create a UserHome task" form: list editing, validation
 * (a mirror of the backend rules, which stay authoritative), the typed request
 * and the preview → confirm flow. Nothing here touches the backend, storage or
 * the DOM, and no environment value is ever put into an error or a message.
 */

export const RUN_AT_LOAD_IMPACT = "services.dialog.note.runAtLoad" satisfies MessageKey;
export const KEEP_ALIVE_IMPACT = "services.dialog.note.keepAlive" satisfies MessageKey;
export const ENVIRONMENT_NOTE = "services.dialog.note.environment" satisfies MessageKey;

const SHELLS = ["sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "rbash", "ash"];
const WRAPPERS = ["env", "xargs", "nohup", "sudo", "su", "doas", "exec", "command"];
const SHELL_REASON = "services.dialog.error.shellProgram" satisfies MessageKey;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL_SUFFIX_PATTERN = /^[A-Za-z0-9._-]+$/;
const MIN_SCRUBBED_VALUE_LENGTH = 2;

export interface ArgumentRow {
  readonly id: number;
  readonly value: string;
}

export interface EnvironmentRow {
  readonly id: number;
  readonly key: string;
  readonly value: string;
}

export interface CreateFormState {
  /** The part after the namespace, or the full label inside it. */
  readonly labelSuffix: string;
  readonly executable: string;
  readonly arguments: readonly ArgumentRow[];
  readonly workingDirectory: string;
  readonly environment: readonly EnvironmentRow[];
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly runAtLoad: boolean;
  readonly keepAlive: boolean;
  /** Ids are never reused, so a removed row cannot be confused with a new one. */
  readonly nextRowId: number;
}

export const INITIAL_CREATE_FORM: CreateFormState = {
  labelSuffix: "",
  executable: "",
  arguments: [],
  workingDirectory: "",
  environment: [],
  stdoutPath: "",
  stderrPath: "",
  runAtLoad: false,
  keepAlive: false,
  nextRowId: 1,
};

type PlainField =
  | "labelSuffix"
  | "executable"
  | "workingDirectory"
  | "stdoutPath"
  | "stderrPath"
  | "runAtLoad"
  | "keepAlive";

export function setFormField<K extends PlainField>(
  state: CreateFormState,
  field: K,
  value: CreateFormState[K],
): CreateFormState {
  return { ...state, [field]: value };
}

/** The list-editing and validation fields, shared with the edit form. */
export interface EditableListFields {
  readonly arguments: readonly ArgumentRow[];
  readonly environment: readonly EnvironmentRow[];
  readonly nextRowId: number;
}

export function addArgument<S extends EditableListFields>(state: S): S {
  return {
    ...state,
    arguments: [...state.arguments, { id: state.nextRowId, value: "" }],
    nextRowId: state.nextRowId + 1,
  };
}

export function updateArgument<S extends EditableListFields>(
  state: S,
  id: number,
  value: string,
): S {
  return {
    ...state,
    arguments: state.arguments.map((row) => (row.id === id ? { ...row, value } : row)),
  };
}

export function removeArgument<S extends EditableListFields>(state: S, id: number): S {
  return { ...state, arguments: state.arguments.filter((row) => row.id !== id) };
}

/** Moves one argument by `delta` places; out of range changes nothing. */
export function moveArgument<S extends EditableListFields>(
  state: S,
  id: number,
  delta: -1 | 1,
): S {
  const from = state.arguments.findIndex((row) => row.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.arguments.length) return state;
  const rows = [...state.arguments];
  [rows[from], rows[to]] = [rows[to], rows[from]];
  return { ...state, arguments: rows };
}

export function addEnvironment<S extends EditableListFields>(state: S): S {
  return {
    ...state,
    environment: [...state.environment, { id: state.nextRowId, key: "", value: "" }],
    nextRowId: state.nextRowId + 1,
  };
}

export function updateEnvironmentKey<S extends EditableListFields>(
  state: S,
  id: number,
  key: string,
): S {
  return {
    ...state,
    environment: state.environment.map((row) => (row.id === id ? { ...row, key } : row)),
  };
}

export function updateEnvironmentValue<S extends EditableListFields>(
  state: S,
  id: number,
  value: string,
): S {
  return {
    ...state,
    environment: state.environment.map((row) => (row.id === id ? { ...row, value } : row)),
  };
}

export function removeEnvironment<S extends EditableListFields>(state: S, id: number): S {
  return { ...state, environment: state.environment.filter((row) => row.id !== id) };
}

// ------------------------------------------------------------- validation

export interface FormErrors {
  label?: string;
  executable?: string;
  /** By argument row id. */
  arguments: Record<number, string>;
  workingDirectory?: string;
  /** By environment row id. */
  environment: Record<number, { key?: string; value?: string }>;
  stdoutPath?: string;
  stderrPath?: string;
  general?: string;
}

export function hasErrors(errors: FormErrors): boolean {
  return (
    errors.label !== undefined ||
    errors.executable !== undefined ||
    errors.workingDirectory !== undefined ||
    errors.stdoutPath !== undefined ||
    errors.stderrPath !== undefined ||
    errors.general !== undefined ||
    Object.keys(errors.arguments).length > 0 ||
    Object.keys(errors.environment).length > 0
  );
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function labelSuffixOf(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith(CREATE_SERVICE_NAMESPACE)
    ? trimmed.slice(CREATE_SERVICE_NAMESPACE.length)
    : trimmed;
}

/** The label the job will have, or `undefined` while nothing usable is typed. */
export function fullLabel(input: string): string | undefined {
  const suffix = labelSuffixOf(input);
  return suffix.length === 0 ? undefined : `${CREATE_SERVICE_NAMESPACE}${suffix}`;
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

function isShellOrWrapper(name: string): boolean {
  return SHELLS.includes(name) || WRAPPERS.includes(name);
}

/** `-c`, `-lc`, `-ic`: short options ending in `c`, the way shells take a command. */
function isCommandFlag(argument: string): boolean {
  return /^-[A-Za-z]*c$/.test(argument);
}

function labelError(input: string, t: TranslateFunction): string | undefined {
  const suffix = labelSuffixOf(input);
  if (suffix.length === 0) return t("services.dialog.error.labelRequired");
  if (byteLength(suffix) > CREATE_SERVICE_LIMITS.labelSuffixBytes) {
    return t("services.dialog.error.labelTooLong", {
      limit: CREATE_SERVICE_LIMITS.labelSuffixBytes,
    });
  }
  if (
    !LABEL_SUFFIX_PATTERN.test(suffix) ||
    suffix.startsWith(".") ||
    suffix.startsWith("-") ||
    suffix.endsWith(".") ||
    suffix.includes("..")
  ) {
    return t("services.dialog.error.labelPattern");
  }
  return undefined;
}

/** An absolute path without `.`, `..`, doubled or trailing separators. `what` is the field's name, already translated. */
function pathError(path: string, what: string, t: TranslateFunction): string | undefined {
  if (path.length === 0) return t("services.dialog.error.pathEmpty", { what });
  if (byteLength(path) > CREATE_SERVICE_LIMITS.pathBytes) {
    return t("services.dialog.error.pathTooLong", { what, limit: CREATE_SERVICE_LIMITS.pathBytes });
  }
  if (hasForbiddenTextCharacters(path)) return t("services.dialog.error.pathControl", { what });
  if (!path.startsWith("/")) return t("services.dialog.error.pathNotAbsolute", { what });
  const parts = path.slice(1).split("/");
  if (
    path.length === 1 ||
    path.endsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return t("services.dialog.error.pathNotCanonical", { what });
  }
  return undefined;
}

function executableError(executable: string, t: TranslateFunction): string | undefined {
  const problem = pathError(executable, t("services.dialog.field.executable"), t);
  if (problem !== undefined) return problem;
  return isShellOrWrapper(baseName(executable)) ? t(SHELL_REASON) : undefined;
}

function argumentErrors(
  rows: readonly ArgumentRow[],
  t: TranslateFunction,
): Record<number, string> {
  const errors: Record<number, string> = {};
  const lookslikeShellCommand =
    rows.some((row) => isCommandFlag(row.value)) &&
    rows.some((row) => isShellOrWrapper(baseName(row.value)));
  rows.forEach((row, index) => {
    if (row.value.length === 0) {
      errors[row.id] = t("services.dialog.error.argumentEmpty");
    } else if (byteLength(row.value) > CREATE_SERVICE_LIMITS.argumentBytes) {
      errors[row.id] = t("services.dialog.error.argumentTooLong", {
        limit: CREATE_SERVICE_LIMITS.argumentBytes,
      });
    } else if (hasForbiddenTextCharacters(row.value)) {
      errors[row.id] = t("services.dialog.error.argumentControl");
    } else if (
      (index === 0 && isShellOrWrapper(baseName(row.value))) ||
      (lookslikeShellCommand && isShellOrWrapper(baseName(row.value)))
    ) {
      errors[row.id] = t("services.dialog.error.argumentShell");
    }
  });
  return errors;
}

export function isBlankEnvironmentRow(row: EnvironmentRow): boolean {
  return row.key.trim().length === 0 && row.value.length === 0;
}

function environmentErrors(
  rows: readonly EnvironmentRow[],
  t: TranslateFunction,
): Record<number, { key?: string; value?: string }> {
  const errors: Record<number, { key?: string; value?: string }> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlankEnvironmentRow(row)) continue;
    const key = row.key.trim();
    const problem: { key?: string; value?: string } = {};
    if (key.length === 0) {
      problem.key = t("services.dialog.error.envKeyRequired");
    } else if (byteLength(key) > CREATE_SERVICE_LIMITS.environmentKeyBytes) {
      problem.key = t("services.dialog.error.envKeyTooLong", {
        limit: CREATE_SERVICE_LIMITS.environmentKeyBytes,
      });
    } else if (!ENV_KEY_PATTERN.test(key)) {
      problem.key = t("services.dialog.error.envKeyPattern");
    } else if (key.startsWith("DYLD_") || key.startsWith("LD_")) {
      problem.key = t("services.dialog.error.envKeyReserved");
    } else if (seen.has(key)) {
      problem.key = t("services.dialog.error.envKeyDuplicate");
    }
    seen.add(key);
    // Messages about a value never repeat the value itself.
    if (byteLength(row.value) > CREATE_SERVICE_LIMITS.environmentValueBytes) {
      problem.value = t("services.dialog.error.envValueTooLong", {
        limit: CREATE_SERVICE_LIMITS.environmentValueBytes,
      });
    } else if (hasForbiddenTextCharacters(row.value)) {
      problem.value = t("services.dialog.error.envValueControl");
    }
    if (problem.key !== undefined || problem.value !== undefined) {
      errors[row.id] = problem;
    }
  }
  return errors;
}

function optionalPathError(
  path: string,
  what: string,
  t: TranslateFunction,
): string | undefined {
  const trimmed = path.trim();
  return trimmed.length === 0 ? undefined : pathError(trimmed, what, t);
}

export interface EditableFormFields extends EditableListFields {
  readonly executable: string;
  readonly workingDirectory: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

/** Every rule except the label, which only a new job has. */
export function validateEditableFields(
  state: EditableFormFields,
  t: TranslateFunction,
): FormErrors {
  const errors: FormErrors = { arguments: {}, environment: {} };
  const executable = executableError(state.executable.trim(), t);
  if (executable !== undefined) errors.executable = executable;
  errors.arguments = argumentErrors(state.arguments, t);
  errors.environment = environmentErrors(state.environment, t);
  for (const [field, what] of [
    ["workingDirectory", t("services.dialog.field.workingDirectory")],
    ["stdoutPath", t("services.dialog.field.stdoutPath")],
    ["stderrPath", t("services.dialog.field.stderrPath")],
  ] as const) {
    const problem = optionalPathError(state[field], what, t);
    if (problem !== undefined) errors[field] = problem;
  }
  if (state.arguments.length > CREATE_SERVICE_LIMITS.arguments) {
    errors.general = t("services.dialog.error.argumentsLimit", {
      limit: CREATE_SERVICE_LIMITS.arguments,
    });
  } else if (
    state.environment.filter((row) => !isBlankEnvironmentRow(row)).length >
    CREATE_SERVICE_LIMITS.environmentEntries
  ) {
    errors.general = t("services.dialog.error.environmentLimit", {
      limit: CREATE_SERVICE_LIMITS.environmentEntries,
    });
  }
  return errors;
}

export function validateCreateForm(state: CreateFormState, t: TranslateFunction): FormErrors {
  const errors = validateEditableFields(state, t);
  const label = labelError(state.labelSuffix, t);
  if (label !== undefined) errors.label = label;
  return errors;
}

export type BuildResult =
  | { readonly ok: true; readonly request: CreateServiceRequest }
  | { readonly ok: false; readonly errors: FormErrors };

function optionalPath(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The typed request for a valid form; arguments and values are kept as typed. */
export function buildCreateRequest(state: CreateFormState, t: TranslateFunction): BuildResult {
  const errors = validateCreateForm(state, t);
  if (hasErrors(errors)) return { ok: false, errors };
  const workingDirectory = optionalPath(state.workingDirectory);
  const stdoutPath = optionalPath(state.stdoutPath);
  const stderrPath = optionalPath(state.stderrPath);
  return {
    ok: true,
    request: {
      label: state.labelSuffix.trim(),
      executable: state.executable.trim(),
      arguments: state.arguments.map((row) => row.value),
      ...(workingDirectory === undefined ? {} : { workingDirectory }),
      environment: Object.fromEntries(
        state.environment
          .filter((row) => !isBlankEnvironmentRow(row))
          .map((row) => [row.key.trim(), row.value]),
      ),
      ...(stdoutPath === undefined ? {} : { stdoutPath }),
      ...(stderrPath === undefined ? {} : { stderrPath }),
      runAtLoad: state.runAtLoad,
      keepAlive: state.keepAlive,
    },
  };
}

/** Hides every environment value of the form wherever it shows up in `text`. */
export function scrubSecrets(
  text: string,
  state: Pick<CreateFormState, "environment">,
  t: TranslateFunction,
): string {
  const values = [
    ...new Set(
      state.environment
        .map((row) => row.value)
        .filter((value) => value.length >= MIN_SCRUBBED_VALUE_LENGTH),
    ),
  ].sort((left, right) => right.length - left.length);
  const redacted = t("services.dialog.redacted");
  return values.reduce((result, value) => result.split(value).join(redacted), text);
}

// --------------------------------------------------------------- the flow

export type CreateDialogState =
  | { readonly phase: "editing"; readonly error?: AppError }
  | { readonly phase: "previewing" }
  | { readonly phase: "preview"; readonly preview: CreateServicePreview }
  | { readonly phase: "creating"; readonly preview: CreateServicePreview }
  | { readonly phase: "done"; readonly execution: CreateServiceExecution }
  | {
      readonly phase: "failed";
      readonly preview: CreateServicePreview;
      /** The confirmation ran but did not leave the file in place. */
      readonly execution?: CreateServiceExecution;
      /** The confirmation was refused; nothing was written. */
      readonly error?: AppError;
    };

export type CreateDialogAction =
  | { readonly type: "previewRequested" }
  | { readonly type: "previewLoaded"; readonly preview: CreateServicePreview }
  | { readonly type: "previewFailed"; readonly error: AppError }
  | { readonly type: "editRequested" }
  | { readonly type: "confirmRequested" }
  | { readonly type: "createFinished"; readonly execution: CreateServiceExecution }
  | { readonly type: "createFailed"; readonly error: AppError };

export const INITIAL_CREATE_DIALOG: CreateDialogState = { phase: "editing" };

export function wasWritten(execution: CreateServiceExecution): boolean {
  return (
    execution.outcome.status === "SUCCEEDED" &&
    execution.outcome.fileState === "WRITTEN"
  );
}

/** Events that do not fit the current phase leave the state as it is. */
export function createDialogReducer(
  state: CreateDialogState,
  action: CreateDialogAction,
): CreateDialogState {
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
    case "confirmRequested":
      return state.phase === "preview"
        ? { phase: "creating", preview: state.preview }
        : state;
    case "createFinished":
      if (state.phase !== "creating") return state;
      return wasWritten(action.execution)
        ? { phase: "done", execution: action.execution }
        : { phase: "failed", preview: state.preview, execution: action.execution };
    case "createFailed":
      return state.phase === "creating"
        ? { phase: "failed", preview: state.preview, error: action.error }
        : state;
  }
}

export interface OutcomeText {
  readonly tone: "success" | "danger";
  readonly title: string;
  readonly detail: string;
}

const FILE_STATE_DETAIL: Record<string, MessageKey> = {
  CREATED_REMOVED: "services.dialog.outcome.createdRemoved",
  CREATED_REMOVE_FAILED: "services.dialog.outcome.createdRemoveFailed",
  UNKNOWN: "services.dialog.outcome.unknownState",
};

export function describeCreateOutcome(
  execution: CreateServiceExecution,
  t: TranslateFunction,
): OutcomeText {
  if (wasWritten(execution)) {
    return {
      tone: "success",
      title: t("services.dialog.outcome.createdTitle", { path: execution.filePath }),
      detail: t("services.dialog.outcome.createdDetail"),
    };
  }
  return {
    tone: "danger",
    title: t("services.dialog.outcome.createFailedTitle"),
    detail: t(FILE_STATE_DETAIL[execution.outcome.fileState] ?? "services.dialog.outcome.createNotWritten"),
  };
}
