import type { AppError } from "../../ipc/core";
import {
  isAppConfigId,
  type AppConfigCapability,
  type AppConfigCategory,
  type AppConfigEntrySummary,
  type AppConfigFileMeta,
  type AppConfigListItem,
  type AppConfigProbeStatus,
  type AppConfigReadResult,
} from "../../ipc/appConfig";

export type ListState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; error: AppError }
  | { status: "ready"; items: AppConfigListItem[] }
  | { status: "partial"; items: AppConfigListItem[]; failedCount: number };

export type DetailState =
  | { status: "idle" }
  | { status: "loading"; requestId: number; id: string }
  | { status: "ready"; requestId: number; id: string; result: AppConfigReadResult }
  | { status: "failed"; requestId: number; id: string; error: AppError };

export interface AppConfigState {
  list: ListState;
  detail: DetailState;
}

export type AppConfigAction =
  | { type: "listRequested" }
  | { type: "listLoaded"; items: AppConfigListItem[] }
  | { type: "listFailed"; error: AppError }
  | { type: "entrySelected"; requestId: number; id: string }
  | { type: "entryLoaded"; requestId: number; id: string; result: AppConfigReadResult }
  | { type: "entryFailed"; requestId: number; id: string; error: AppError };

export const INITIAL_APP_CONFIG_STATE: AppConfigState = {
  list: { status: "loading" },
  detail: { status: "idle" },
};

/** An entry is inspectable only when the listing that the backend returned names it. */
export function isKnownEntry(state: AppConfigState, id: string): boolean {
  if (!isAppConfigId(id)) return false;
  return listedItems(state.list).some((item) => item.summary.id === id);
}

function listedItems(list: ListState): AppConfigListItem[] {
  return list.status === "ready" || list.status === "partial" ? list.items : [];
}

export function isInspectionFailure(probe: AppConfigProbeStatus): boolean {
  return probe.status === "inaccessible" || probe.status === "outOfBounds";
}

function listStateFrom(items: AppConfigListItem[]): ListState {
  if (items.length === 0) return { status: "empty" };
  const failedCount = items.filter((item) => isInspectionFailure(item.probe)).length;
  return failedCount > 0
    ? { status: "partial", items, failedCount }
    : { status: "ready", items };
}

export function appConfigReducer(
  state: AppConfigState,
  action: AppConfigAction,
): AppConfigState {
  switch (action.type) {
    case "listRequested":
      return { ...state, list: { status: "loading" } };
    case "listLoaded": {
      const list = listStateFrom(action.items);
      const { detail } = state;
      const keepsSelection =
        detail.status !== "idle" &&
        action.items.some((item) => item.summary.id === detail.id);
      return {
        list,
        detail: keepsSelection ? detail : { status: "idle" },
      };
    }
    case "listFailed":
      return { list: { status: "error", error: action.error }, detail: { status: "idle" } };
    case "entrySelected":
      if (!isKnownEntry(state, action.id)) return state;
      return {
        ...state,
        detail: { status: "loading", requestId: action.requestId, id: action.id },
      };
    case "entryLoaded":
      if (!isCurrentRequest(state.detail, action.requestId, action.id)) return state;
      return {
        ...state,
        detail: {
          status: "ready",
          requestId: action.requestId,
          id: action.id,
          result: action.result,
        },
      };
    case "entryFailed":
      if (!isCurrentRequest(state.detail, action.requestId, action.id)) return state;
      return {
        ...state,
        detail: {
          status: "failed",
          requestId: action.requestId,
          id: action.id,
          error: action.error,
        },
      };
  }
}

function isCurrentRequest(
  detail: DetailState,
  requestId: number,
  id: string,
): boolean {
  return (
    detail.status === "loading" &&
    detail.requestId === requestId &&
    detail.id === id
  );
}

export const CATEGORY_ORDER: readonly AppConfigCategory[] = [
  "editor",
  "aiClient",
  "terminal",
  "developerTool",
  "system",
];

export const CATEGORY_LABELS: Record<AppConfigCategory, string> = {
  editor: "编辑器",
  aiClient: "AI 客户端",
  terminal: "终端",
  developerTool: "开发工具",
  system: "系统",
};

export interface AppConfigGroup {
  category: AppConfigCategory;
  label: string;
  items: AppConfigListItem[];
}

/** Groups keep registry order inside each category and skip empty categories. */
export function groupByCategory(items: readonly AppConfigListItem[]): AppConfigGroup[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const members = items.filter((item) => item.summary.category === category);
    return members.length === 0
      ? []
      : [{ category, label: CATEGORY_LABELS[category], items: members }];
  });
}

export const CAPABILITY_LABELS: Record<AppConfigCapability, string> = {
  discoverOnly: "仅探测存在",
  readOnly: "只读",
  writable: "可编辑",
};

export type ProbeTone = "neutral" | "success" | "warning" | "danger";

export interface ProbeBadge {
  symbol: string;
  label: string;
  tone: ProbeTone;
}

/** Each state carries a text label and a symbol, so colour is never the only cue. */
export function describeProbe(probe: AppConfigProbeStatus): ProbeBadge {
  switch (probe.status) {
    case "found":
      return { symbol: "✓", label: "已发现", tone: "success" };
    case "notFound":
      return { symbol: "○", label: "未发现", tone: "neutral" };
    case "symlinkOrNonRegular":
      return { symbol: "⚠", label: "符号链接或非常规文件", tone: "warning" };
    case "inaccessible":
      return { symbol: "⊘", label: "不可访问", tone: "danger" };
    case "outOfBounds":
      return { symbol: "✕", label: "越界", tone: "danger" };
  }
}

export function isFixedLocation(summary: AppConfigEntrySummary): boolean {
  return !summary.displayPath.startsWith("~/");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatModifiedTime(unixMillis: number): string {
  return new Date(unixMillis).toLocaleString("zh-CN", { hour12: false });
}

export function metaRows(meta: AppConfigFileMeta): Array<[string, string]> {
  return [
    ["大小", formatBytes(meta.size)],
    ["修改时间", formatModifiedTime(meta.modifiedUnixMillis)],
  ];
}

const FAILURE_MESSAGES = {
  tooLarge: "文件超过读取上限，未读取内容。",
  parseError: "无法按该格式解析，未显示内容。",
  unreadable: "文件无法读取，未显示内容。",
} as const;

const UNAVAILABLE_MESSAGES: Record<
  Exclude<AppConfigProbeStatus["status"], "found">,
  string
> = {
  notFound: "该默认位置没有文件。",
  symlinkOrNonRegular: "该位置是符号链接或非常规文件，未读取。",
  inaccessible: "没有权限访问该位置，未读取。",
  outOfBounds: "该位置解析后超出允许范围，未读取。",
};

export type EntryDetailView =
  | {
      kind: "content";
      text: string;
      redacted: boolean;
      withheldLines: number;
      warnings: Array<{ line: number; message: string }>;
    }
  | { kind: "metadata"; note: string; rows: Array<[string, string]> }
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string };

/**
 * Credentials and metadata-only entries never get a content view. The note says
 * why, so the absence of content is explained rather than looking like a bug.
 */
export function describeEntryDetail(
  summary: AppConfigEntrySummary,
  result: AppConfigReadResult,
): EntryDetailView {
  switch (result.outcome) {
    case "content":
      return {
        kind: "content",
        text: result.view.text,
        redacted: result.view.redacted,
        withheldLines: result.view.withheldLines,
        warnings: result.view.warnings,
      };
    case "metadataOnly":
      return {
        kind: "metadata",
        note: metadataNote(summary),
        rows: metaRows(result.meta),
      };
    case "unavailable":
      return { kind: "unavailable", message: UNAVAILABLE_MESSAGES[result.status.status] };
    case "failed":
      return { kind: "failed", message: FAILURE_MESSAGES[result.kind] };
  }
}

function metadataNote(summary: AppConfigEntrySummary): string {
  if (summary.sensitivity === "credentials") {
    return "凭据类文件：仅确认存在，不读取内容。";
  }
  if (summary.format === "plist" || summary.format === "dotenv") {
    return "此格式暂不解析：仅显示已发现、大小与修改时间，不读取内容。";
  }
  return "仅显示已发现、大小与修改时间，不读取内容。";
}
