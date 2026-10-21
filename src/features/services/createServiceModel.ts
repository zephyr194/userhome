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

export const RUN_AT_LOAD_IMPACT =
  "登录后自动启动。开启后：配置被加载（登录时 launchd 会自动加载 ~/Library/LaunchAgents 中的配置）就会立即启动任务，之后每次登录都会如此，直到配置被卸载或删除。";
export const KEEP_ALIVE_IMPACT =
  "退出后自动重启。开启后：任务无论正常退出还是崩溃，launchd 都会立即重新启动它；要让它真正停下，需要卸载或禁用该任务。";
export const ENVIRONMENT_NOTE =
  "环境变量值可能包含密钥：此处输入已隐藏，只会写入这个任务自己的配置文件，不会影响其他任务；预览与操作记录中只显示变量名。";

const SHELLS = ["sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "rbash", "ash"];
const WRAPPERS = ["env", "xargs", "nohup", "sudo", "su", "doas", "exec", "command"];
const SHELL_REASON =
  "不能把 shell 或 env、sudo 等包装器作为程序：任务必须直接运行目标程序，不经 shell。";
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

function labelError(input: string): string | undefined {
  const suffix = labelSuffixOf(input);
  if (suffix.length === 0) return "请输入任务名称（label 后缀）。";
  if (byteLength(suffix) > CREATE_SERVICE_LIMITS.labelSuffixBytes) {
    return `名称不能超过 ${CREATE_SERVICE_LIMITS.labelSuffixBytes} 字节。`;
  }
  if (
    !LABEL_SUFFIX_PATTERN.test(suffix) ||
    suffix.startsWith(".") ||
    suffix.startsWith("-") ||
    suffix.endsWith(".") ||
    suffix.includes("..")
  ) {
    return "名称只能包含字母、数字、点、连字符和下划线，不能以点或连字符开头、以点结尾，也不能含连续的点。";
  }
  return undefined;
}

/** An absolute path without `.`, `..`, doubled or trailing separators. */
function pathError(path: string, what: string): string | undefined {
  if (path.length === 0) return `${what}不能为空。`;
  if (byteLength(path) > CREATE_SERVICE_LIMITS.pathBytes) {
    return `${what}不能超过 ${CREATE_SERVICE_LIMITS.pathBytes} 字节。`;
  }
  if (hasForbiddenTextCharacters(path)) return `${what}含有换行或其他控制字符。`;
  if (!path.startsWith("/")) return `${what}必须是以 / 开头的绝对路径（不展开 ~）。`;
  const parts = path.slice(1).split("/");
  if (
    path.length === 1 ||
    path.endsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return `${what}必须是规范路径（不含 . 、.. 、连续或结尾的 /）。`;
  }
  return undefined;
}

function executableError(executable: string): string | undefined {
  const problem = pathError(executable, "可执行文件路径");
  if (problem !== undefined) return problem;
  return isShellOrWrapper(baseName(executable)) ? SHELL_REASON : undefined;
}

function argumentErrors(rows: readonly ArgumentRow[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const lookslikeShellCommand =
    rows.some((row) => isCommandFlag(row.value)) &&
    rows.some((row) => isShellOrWrapper(baseName(row.value)));
  rows.forEach((row, index) => {
    if (row.value.length === 0) {
      errors[row.id] = "参数不能为空；不需要的话请删除这一行。";
    } else if (byteLength(row.value) > CREATE_SERVICE_LIMITS.argumentBytes) {
      errors[row.id] = `参数不能超过 ${CREATE_SERVICE_LIMITS.argumentBytes} 字节。`;
    } else if (hasForbiddenTextCharacters(row.value)) {
      errors[row.id] = "参数含有换行、NUL 或其他控制字符。";
    } else if (
      (index === 0 && isShellOrWrapper(baseName(row.value))) ||
      (lookslikeShellCommand && isShellOrWrapper(baseName(row.value)))
    ) {
      errors[row.id] = "参数在借用 shell 或包装器运行命令（如 bash -c …），已拒绝；请直接指定目标程序。";
    }
  });
  return errors;
}

export function isBlankEnvironmentRow(row: EnvironmentRow): boolean {
  return row.key.trim().length === 0 && row.value.length === 0;
}

function environmentErrors(
  rows: readonly EnvironmentRow[],
): Record<number, { key?: string; value?: string }> {
  const errors: Record<number, { key?: string; value?: string }> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlankEnvironmentRow(row)) continue;
    const key = row.key.trim();
    const problem: { key?: string; value?: string } = {};
    if (key.length === 0) {
      problem.key = "请填写变量名。";
    } else if (byteLength(key) > CREATE_SERVICE_LIMITS.environmentKeyBytes) {
      problem.key = `变量名不能超过 ${CREATE_SERVICE_LIMITS.environmentKeyBytes} 字节。`;
    } else if (!ENV_KEY_PATTERN.test(key)) {
      problem.key = "变量名只能包含字母、数字和下划线，且不能以数字开头。";
    } else if (key.startsWith("DYLD_") || key.startsWith("LD_")) {
      problem.key = "DYLD_ / LD_ 开头的是动态加载器保留变量，不允许设置。";
    } else if (seen.has(key)) {
      problem.key = "变量名重复。";
    }
    seen.add(key);
    // Messages about a value never repeat the value itself.
    if (byteLength(row.value) > CREATE_SERVICE_LIMITS.environmentValueBytes) {
      problem.value = `变量值不能超过 ${CREATE_SERVICE_LIMITS.environmentValueBytes} 字节。`;
    } else if (hasForbiddenTextCharacters(row.value)) {
      problem.value = "变量值含有换行、NUL 或其他控制字符。";
    }
    if (problem.key !== undefined || problem.value !== undefined) {
      errors[row.id] = problem;
    }
  }
  return errors;
}

function optionalPathError(path: string, what: string): string | undefined {
  const trimmed = path.trim();
  return trimmed.length === 0 ? undefined : pathError(trimmed, what);
}

export interface EditableFormFields extends EditableListFields {
  readonly executable: string;
  readonly workingDirectory: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

/** Every rule except the label, which only a new job has. */
export function validateEditableFields(state: EditableFormFields): FormErrors {
  const errors: FormErrors = { arguments: {}, environment: {} };
  const executable = executableError(state.executable.trim());
  if (executable !== undefined) errors.executable = executable;
  errors.arguments = argumentErrors(state.arguments);
  errors.environment = environmentErrors(state.environment);
  for (const [field, what] of [
    ["workingDirectory", "工作目录"],
    ["stdoutPath", "标准输出日志路径"],
    ["stderrPath", "标准错误日志路径"],
  ] as const) {
    const problem = optionalPathError(state[field], what);
    if (problem !== undefined) errors[field] = problem;
  }
  if (state.arguments.length > CREATE_SERVICE_LIMITS.arguments) {
    errors.general = `参数最多 ${CREATE_SERVICE_LIMITS.arguments} 项。`;
  } else if (
    state.environment.filter((row) => !isBlankEnvironmentRow(row)).length >
    CREATE_SERVICE_LIMITS.environmentEntries
  ) {
    errors.general = `环境变量最多 ${CREATE_SERVICE_LIMITS.environmentEntries} 项。`;
  }
  return errors;
}

export function validateCreateForm(state: CreateFormState): FormErrors {
  const errors = validateEditableFields(state);
  const label = labelError(state.labelSuffix);
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
export function buildCreateRequest(state: CreateFormState): BuildResult {
  const errors = validateCreateForm(state);
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
export function scrubSecrets(text: string, state: CreateFormState): string {
  const values = [
    ...new Set(
      state.environment
        .map((row) => row.value)
        .filter((value) => value.length >= MIN_SCRUBBED_VALUE_LENGTH),
    ),
  ].sort((left, right) => right.length - left.length);
  return values.reduce((result, value) => result.split(value).join("[已隐藏]"), text);
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

const FILE_STATE_DETAIL: Record<string, string> = {
  CREATED_REMOVED: "写入后校验未通过，新建的文件已删除，没有留下任何变更。",
  CREATED_REMOVE_FAILED:
    "写入后校验未通过，且新建的文件无法删除：它仍可能存在，请检查 ~/Library/LaunchAgents。",
  UNKNOWN: "无法确认文件的当前状态，请检查 ~/Library/LaunchAgents 后再决定下一步。",
};

export function describeCreateOutcome(execution: CreateServiceExecution): OutcomeText {
  if (wasWritten(execution)) {
    return {
      tone: "success",
      title: `已创建配置文件 ${execution.filePath}`,
      detail: "新任务尚未加载，也未启动；加载与启动需要另外确认。",
    };
  }
  return {
    tone: "danger",
    title: "创建未完成",
    detail:
      FILE_STATE_DETAIL[execution.outcome.fileState] ??
      "写入没有完成；请检查 ~/Library/LaunchAgents 中是否留有该文件。",
  };
}
