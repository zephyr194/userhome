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
import { failureText } from "./environmentModel";

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

export const SOURCE_LABEL = "官方文档";

const APPLIES_TO_TEXT: Record<ZshAppliesTo, { label: string; detail: string }> = {
  ALL: {
    label: "所有 zsh",
    detail: "每次启动 zsh 都会读取，包括登录、交互和非交互（脚本）。",
  },
  LOGIN: {
    label: "仅登录 shell",
    detail: "只在登录 shell 中读取，普通的交互终端标签通常不是登录 shell。",
  },
  INTERACTIVE: {
    label: "仅交互 shell",
    detail: "只在交互式 shell 中读取，不会在运行脚本时读取。",
  },
};

export function appliesToText(appliesTo: ZshAppliesTo) {
  return APPLIES_TO_TEXT[appliesTo];
}

const VALUE_STATE_TEXT: Record<ZshValueState, { label: string; hint: string }> = {
  STATIC: {
    label: "字面量",
    hint: "值就是写在文件里的文本；这不代表它最终生效。",
  },
  REFERENCE: {
    label: "含引用（未解析）",
    hint: "含 $HOME、$PATH 或 ~ 引用，按原文显示，没有展开。",
  },
  DYNAMIC: {
    label: "动态／未解析",
    hint: "需要执行或求值才能知道结果，按原文显示，不推断有效值。",
  },
};

export function valueStateText(state: ZshValueState) {
  return VALUE_STATE_TEXT[state];
}

const REASON_TEXT: Record<ZshDynamicReason, { label: string; hint: string }> = {
  COMMAND_SUBSTITUTION: { label: "命令替换", hint: "含 $(…) 或反引号，没有执行。" },
  ARITHMETIC: { label: "算术展开", hint: "含 $((…)) 或 ((…))，没有求值。" },
  UNRESOLVED_REFERENCE: {
    label: "未解析的变量引用",
    hint: "引用了 $HOME、$PATH 之外的变量，没有展开。",
  },
  CONDITIONAL: { label: "条件语句", hint: "if、case、循环或 [[ ]] 条件，是否执行取决于运行时。" },
  BLOCK: { label: "位于块内", hint: "在 if/case/循环/函数/分组之内，是否执行取决于运行时。" },
  SOURCE: { label: "source 其他文件", hint: "source 或 . 会读入另一个文件，没有跟随。" },
  EVAL: { label: "eval", hint: "eval 会把文本当作命令执行，没有执行。" },
  FUNCTION_DEFINITION: { label: "函数定义", hint: "函数体只在被调用时运行，没有分析。" },
  ALIAS: { label: "别名", hint: "别名定义，没有展开。" },
  COMPOUND: { label: "复合命令", hint: "一行含多个命令、管道或重定向，没有拆解。" },
  LINE_CONTINUATION: { label: "行续接", hint: "反斜杠续行的语句，保守地不识别。" },
  HERE_DOC: { label: "here-doc", hint: "含 here-doc 正文，保守地不识别。" },
  MULTILINE_QUOTE: { label: "多行引号", hint: "引号跨越多行，保守地不识别。" },
  EXPANSION: { label: "其他展开", hint: "含 $'…' 等未解码的写法，保守地不识别。" },
};

export function reasonText(reason: ZshDynamicReason) {
  return REASON_TEXT[reason];
}

const UNDETERMINED_TEXT: Record<ZshUndeterminedReason, string> = {
  DYNAMIC:
    "~/.zshenv 里对 ZDOTDIR 的设置是动态、条件或变量引用写法，无法静态确定。",
  MULTIPLE: "~/.zshenv 里多次设置了 ZDOTDIR，无法静态确定哪一次生效。",
  UNSUPPORTED_FORM:
    "~/.zshenv 里的 ZDOTDIR 写法不受支持（相对路径、空值、追加等），无法静态确定。",
  ZSHENV_NOT_READ: "~/.zshenv 无法读取，因此不知道 ZDOTDIR 是否被设置。",
  PARENT_SEGMENT:
    "~/.zshenv 里的 ZDOTDIR 路径含有 .. 段，不做字面折算，无法静态确定它指向哪里。",
};

export function undeterminedText(reason: ZshUndeterminedReason): string {
  return UNDETERMINED_TEXT[reason];
}

/** PATH items may be empty; an empty item means the current directory. */
export function pathSegmentText(text: string): string {
  return text === "" ? "（空项，表示当前目录）" : text;
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

export function zdotdirSummary(zdotdir: ZshZdotdir): ZdotdirSummary {
  switch (zdotdir.status) {
    case "DEFAULT":
      return {
        title: "ZDOTDIR：未设置，使用 $HOME",
        detail:
          "~/.zshenv 没有静态的 ZDOTDIR 设置，其余启动文件从 $HOME（主目录）读取。",
        tone: "neutral",
        needsChoice: false,
        selected: false,
      };
    case "STATIC":
      return {
        title: "ZDOTDIR：已确定",
        detail: `~/.zshenv 第 ${zdotdir.line} 行把 ZDOTDIR 设为 ${zdotdir.displayPath}，.zprofile、.zshrc、.zlogin 从该目录读取。`,
        tone: "success",
        needsChoice: false,
        selected: false,
      };
    case "OUTSIDE":
      return {
        title: "ZDOTDIR：越界，未读取",
        detail: `~/.zshenv 第 ${zdotdir.line} 行把 ZDOTDIR 设为 ${zdotdir.displayPath}，它不在主目录之下，UserHome 不读取该目录。`,
        tone: "danger",
        needsChoice: false,
        selected: false,
      };
    case "SELECTED":
      return {
        title: "ZDOTDIR：由你选择",
        detail: `ZDOTDIR 无法静态确定，已按你选择的目录 ${zdotdir.displayPath} 读取 .zprofile、.zshrc、.zlogin。这是你的选择，不代表 zsh 实际使用该目录。`,
        tone: "warning",
        needsChoice: false,
        selected: true,
      };
    case "UNDETERMINED":
      return {
        title: "ZDOTDIR：未确定",
        detail: `${undeterminedText(zdotdir.reason)}请选择 .zprofile、.zshrc、.zlogin 所在的目录（只能选择主目录之下的目录），否则这三个文件不会被读取。`,
        tone: "warning",
        needsChoice: true,
        selected: false,
        ...(zdotdir.selectionProblem === undefined
          ? {}
          : { problem: zdotdir.selectionProblem }),
      };
  }
}

export function stepStatus(step: Pick<ZshOrderStep, "scope">): string | undefined {
  return step.scope === "SYSTEM" ? "系统级，未读取" : undefined;
}

export function fileStatus(file: ZshFile): { label: string; tone: SummaryTone } {
  const { outcome } = file;
  switch (outcome.status) {
    case "READY":
      return { label: "已读取", tone: "success" };
    case "UNAVAILABLE":
      return outcome.reason === "NOT_FOUND"
        ? { label: "不存在", tone: "neutral" }
        : { label: `无法读取：${failureText(outcome.reason)}`, tone: "danger" };
    case "OUTSIDE_HOME":
      return { label: "越界，未读取", tone: "danger" };
    case "NOT_LOCATED":
      return { label: "位置未确定，未读取", tone: "warning" };
  }
}

export interface ZshSummary {
  readonly kind: "ok" | "empty" | "partial";
  /** Files that could not be read for a reason other than being absent. */
  readonly problems: readonly string[];
}

export function summarize(overview: ZshOverview): ZshSummary {
  const absent = (file: ZshFile) =>
    file.outcome.status === "UNAVAILABLE" && file.outcome.reason === "NOT_FOUND";
  if (overview.files.every(absent)) return { kind: "empty", problems: [] };
  const problems = overview.files
    .filter((file) => file.outcome.status !== "READY" && !absent(file))
    .map((file) => `${file.name}：${fileStatus(file).label}`);
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
}

export type ZshNameNote =
  | { readonly kind: "replaces"; readonly replaced: readonly ZshLocation[] }
  | { readonly kind: "shared"; readonly others: readonly ZshLocation[] };

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
  readonly file: ZshFileKey;
  readonly fileName: string;
  readonly line: number;
  readonly row: ZshEntryRow;
}

/**
 * The last assignment of a name in reading order replaces the earlier ones. A
 * last assignment that appends (`+=`) or is dynamic says nothing about the final
 * value, so every occurrence stays and only points at the others. When any file
 * was cut short, nothing is resolved: a later occurrence may sit past the cut.
 */
export function resolveZshNames(overview: ZshOverview): ZshNameResolution {
  const files = [...overview.files].sort((left, right) => left.position - right.position);
  const truncated = files.some(
    (file) => file.outcome.status === "READY" && file.outcome.rowsTruncated,
  );
  if (truncated) return { hidden: new Set(), notes: new Map() };

  const byName = new Map<string, NameItem[]>();
  for (const file of files) {
    if (file.outcome.status !== "READY") continue;
    for (const row of file.outcome.rows) {
      if (row.kind !== "ENTRY") continue;
      const items = byName.get(row.name) ?? [];
      items.push({ file: file.file, fileName: file.name, line: row.line, row });
      byName.set(row.name, items);
    }
  }

  const hidden = new Set<string>();
  const notes = new Map<string, ZshNameNote>();
  const location = (item: NameItem): ZshLocation => ({ fileName: item.fileName, line: item.line });
  for (const items of byName.values()) {
    if (items.length < 2) continue;
    const last = items[items.length - 1];
    if (last === undefined) continue;
    const earlier = items.slice(0, -1);
    if (last.row.operation === "SET" && last.row.state !== "DYNAMIC") {
      for (const item of earlier) hidden.add(zshRowKey(item.file, item.line));
      notes.set(zshRowKey(last.file, last.line), {
        kind: "replaces",
        replaced: earlier.map(location),
      });
      continue;
    }
    for (const item of items) {
      notes.set(zshRowKey(item.file, item.line), {
        kind: "shared",
        others: items.filter((other) => other !== item).map(location),
      });
    }
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

