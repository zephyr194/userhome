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

export function nameProblem(name: string): string | undefined {
  if (name === "") return "请填写变量名。";
  if (!NAME_PATTERN.test(name)) {
    return "变量名必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 255 个字符。";
  }
  if (RESERVED_NAMES.includes(name)) {
    return "PATH 请通过下面的 PATH 列表编辑，不能作为普通变量写入。";
  }
  return undefined;
}

export function valueProblem(value: string): string | undefined {
  if (FORBIDDEN_CHARACTERS.test(value)) {
    return "值含换行、制表符或其他控制 / 不可见方向字符，不能安全写成单行字面量。";
  }
  if ([...value].length > MAX_EDIT_VALUE_CHARS) {
    return `值超过 ${MAX_EDIT_VALUE_CHARS} 个字符。`;
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
export function normalizePathItem(raw: string): PathNormalization {
  const refuse = (problem: string): PathNormalization => ({ ok: false, problem });
  if (raw === "") return refuse("PATH 项不能为空；空项会让 shell 搜索当前目录。");
  if (FORBIDDEN_CHARACTERS.test(raw)) return refuse("PATH 项含控制字符或不可见字符。");
  if (raw.trim() !== raw) return refuse("PATH 项首尾不能有空白。");
  if (raw.includes(":")) return refuse("PATH 项不能含“:”，请拆成多项。");
  if ([...raw].length > MAX_PATH_ITEM_CHARS) {
    return refuse(`PATH 项超过 ${MAX_PATH_ITEM_CHARS} 个字符。`);
  }
  for (const prefix of ["~", "$HOME", "${HOME}"]) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      if (rest === "" || rest.startsWith("/")) return { ok: true, item: `$HOME${rest}` };
    }
  }
  return raw.startsWith("/")
    ? { ok: true, item: raw }
    : refuse("PATH 项必须是绝对路径（以 / 开头），或以 ~、$HOME 开头。");
}

// ---- availability --------------------------------------------------------------

export type EditAvailability =
  | { readonly kind: "ready" }
  /** Editing has not been enabled for this file yet. */
  | { readonly kind: "needs-enable" }
  /** The block is damaged: nothing structured is written, nothing is repaired. */
  | { readonly kind: "blocked"; readonly reason: string };

export function editAvailability(state: ZshEditState): EditAvailability {
  if (state.block.status === "BROKEN") {
    return {
      kind: "blocked",
      reason: `UserHome 专用块的结构异常，已阻止结构化写入（不会尝试修复）：${state.block.message}请先手动整理该文件。`,
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
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!variable.secret && variable.hasValue && variable.value === undefined) {
    return { ok: false, reason: "值过长（超过 4096 个字符），不在此修改。" };
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

export function checkDrafts(state: ZshEditState, drafts: ZshDrafts): ZshDraftCheck {
  const variables = managedVariables(state);
  const edits: ZshVariableEdit[] = [];
  const variableProblems: Record<string, string> = {};
  const additionProblems: Record<number, string> = {};
  const pathProblems: Record<number, string> = {};

  for (const [name, draft] of Object.entries(drafts.variables)) {
    if (draft.mode === "keep") continue;
    const current = variables.find((candidate) => candidate.name === name);
    if (current === undefined) {
      variableProblems[name] = "专用块中没有这个变量，请重新加载文件。";
      continue;
    }
    const editability = variableEditability(current);
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
    const problem = valueProblem(draft.value);
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
      nameProblem(addition.name) ??
      (taken.has(addition.name)
        ? "该变量已在专用块内，请直接修改它。"
        : (counts.get(addition.name) ?? 0) > 1
          ? "变量名重复，一次保存里同一个变量只能出现一次。"
          : valueProblem(addition.value));
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
      additionProblems[first.id] = `专用块最多管理 ${MAX_ZSH_VARIABLES} 个变量。`;
    }
  }

  // PATH: the draft list as stored items, compared with what the block holds.
  const normalized: (string | undefined)[] = drafts.path.map((entry) => {
    const result = normalizePathItem(entry.text);
    if (!result.ok) {
      pathProblems[entry.id] = result.problem;
      return undefined;
    }
    return result.item;
  });
  if (drafts.path.length > MAX_ZSH_PATH_ITEMS) {
    const last = drafts.path[drafts.path.length - 1];
    if (last !== undefined && pathProblems[last.id] === undefined) {
      pathProblems[last.id] = `专用块最多管理 ${MAX_ZSH_PATH_ITEMS} 个 PATH 项。`;
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
export function outsideConflicts(state: ZshEditState, name: string): OutsideConflict[] {
  return state.outside.variables
    .filter((variable) => variable.name === name)
    .map((variable) => ({
      line: variable.line,
      beforeBlock: variable.beforeBlock,
      text: variable.beforeBlock
        ? `第 ${variable.line} 行在专用块之前已有同名赋值，不会被删除；专用块里的赋值在它之后，会覆盖它。`
        : `第 ${variable.line} 行在专用块之后有同名赋值，不会被删除；它在后面执行，会覆盖专用块里的值。`,
    }));
}

// ---- wording ---------------------------------------------------------------------------------

/** Said after a successful save; nothing broader is ever claimed. */
export const ZSH_EFFECT_NOTE =
  "只修改了文件：不会 source，也不会执行任何命令。改动仅对之后新开的终端（新 shell）可能生效，不影响正在运行的进程、已打开的终端或图形界面应用。";

export const PATH_FORM_NOTE =
  "PATH 项按字面量写入：以 / 开头的绝对路径用单引号；以 ~ 或 $HOME 开头的项写成 \"$HOME\"/'…'，由 shell 在新终端里展开为主目录。专用块里的 PATH 写成 export path=(… $path)：你列出的项放在最前，原有 PATH 完整保留，也不会产生空项（空项表示当前目录）。";

export const VALUE_FORM_NOTE =
  "值按单引号字面量写入（值里的 ' 写作 '\\''）：引号、$、反引号、;、&、|、反斜杠和 Unicode 都只是普通字符，不会变成命令或展开；含换行、NUL、控制字符的值会被拒绝。";

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

const IMPACT_EXTRA: Record<ZshFileKey, string> = {
  ZSHENV: "每个 zsh 都会读取它，包括运行脚本的非交互 shell，影响面最大；这里只建议放确实需要全局可见的内容。",
  ZPROFILE: "登录 shell 启动时读取，早于 .zshrc；普通交互终端标签通常不是登录 shell，所以改动不一定出现在每个终端里。",
  ZSHRC: "交互式 shell 启动时读取，是日常终端最常用的位置，也是默认目标。",
  ZLOGIN: "登录 shell 在 .zshrc 之后读取，适合只在登录时需要的内容。",
};

export function fileImpact(state: Pick<ZshEditState, "file" | "appliesTo" | "position">): FileImpact {
  const applies = appliesToText(state.appliesTo);
  return {
    label: applies.label,
    detail: `${applies.detail}${IMPACT_EXTRA[state.file]}`,
    order: `在 zsh 读取顺序中排第 ${state.position} 位；后读取的文件可以覆盖先读取的设置。`,
  };
}

export function warningText(warning: ZshEditWarning): string {
  switch (warning.kind) {
    case "OVERRIDES_EARLIER_ASSIGNMENT":
      return `${warning.name}：第 ${warning.line} 行在专用块之前已有同名赋值，保留不动；专用块在它之后，会覆盖它。`;
    case "OVERRIDDEN_BY_LATER_ASSIGNMENT":
      return `${warning.name}：第 ${warning.line} 行在专用块之后有同名赋值，保留不动；它会覆盖专用块里的值。`;
    case "DUPLICATE_PATH_ITEM":
      return `PATH 项 ${warning.item} 在专用块里重复出现，按所写保留。`;
    case "PATH_ITEM_ALSO_OUTSIDE":
      return `PATH 项 ${warning.item} 在第 ${warning.line} 行的块外 PATH 里已有。`;
    case "DYNAMIC_PATH_OUTSIDE":
      return `第 ${warning.line} 行的 PATH 写法是动态／未解析的：按原文保留，不展开、不改写；专用块的项只是放在它的结果之前。`;
    case "LATER_PATH_ASSIGNMENT":
      return `第 ${warning.line} 行在专用块之后直接给 PATH 赋值，可能替换专用块构造的 PATH。`;
    case "BLOCK_APPENDED":
      return "文件里还没有专用块：会在文件末尾追加一个（原有内容的每个字节保持不变）。";
    case "FILE_CREATED":
      return "该文件不存在：会创建新文件（仅所有者可读写），没有恢复点。";
    case "SENSITIVE_VARIABLE":
      return `${warning.name}：这个变量会改变 shell 或动态链接器的行为，有风险（可能让每个新终端的行为发生变化）；仍可保存，请确认你清楚它的作用。`;
  }
}

export function previewKindText(preview: Pick<ZshEditPreview, "kind" | "createdBlock">): string {
  if (preview.kind === "CREATE") return "将创建新文件，并写入专用块";
  return preview.createdBlock ? "将在文件末尾追加专用块" : "将修改文件中的专用块";
}

export const NOT_ENABLED_TEXT =
  "尚未对这个文件启用编辑。点击“启用编辑”后，UserHome 会为这个具体文件创建一项可撤销的授权（不会写入任何内容）；之后的每次保存仍要先预览并确认。";
