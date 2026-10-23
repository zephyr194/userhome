import type { CodeLanguage } from "../../components/ui/codeTokens";
import {
  translate,
  type Locale,
  type MessageKey,
  type TranslateFunction,
} from "../../i18n";
import { formatByteSize, formatDateTime } from "../../i18n/format";
import { appConfigDefinitionEn } from "../../i18n/messages/appConfig";
import type { AppError } from "../../ipc/core";
import {
  isAppConfigId,
  type AppConfigCapability,
  type AppConfigCategory,
  type AppConfigEntrySummary,
  type AppConfigFileMeta,
  type AppConfigListItem,
  type AppConfigProbeStatus,
  type AppConfigReadFailure,
  type AppConfigReadResult,
} from "../../ipc/appConfig";

export interface AppConfigCopy {
  locale: Locale;
  t: TranslateFunction;
}

export function appConfigCopy(locale: Locale): AppConfigCopy {
  return { locale, t: (key, params) => translate(locale, key, params) };
}

/** Default for callers without a locale; keeps the zh-CN text the backend and tests expect. */
export const ZH_COPY: AppConfigCopy = appConfigCopy("zh-CN");

/** Backend-defined names and descriptions are translated only when the English table has them. */
export function definitionText(copy: AppConfigCopy, key: string, original: string): string {
  return copy.locale === "en" ? (appConfigDefinitionEn[key] ?? original) : original;
}

export function entryName(summary: AppConfigEntrySummary, copy: AppConfigCopy = ZH_COPY): string {
  return definitionText(copy, `entry.${summary.id}`, summary.name);
}

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
  "terminal",
  "developerTool",
  "system",
];

export const CATEGORY_LABELS: Record<AppConfigCategory, MessageKey> = {
  editor: "appConfig.category.editor",
  terminal: "appConfig.category.terminal",
  developerTool: "appConfig.category.developerTool",
  system: "appConfig.category.system",
};

export interface AppConfigGroup {
  category: AppConfigCategory;
  label: string;
  items: AppConfigListItem[];
}

/** Groups keep registry order inside each category and skip empty categories. */
export function groupByCategory(
  items: readonly AppConfigListItem[],
  copy: AppConfigCopy = ZH_COPY,
): AppConfigGroup[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const members = items.filter((item) => item.summary.category === category);
    return members.length === 0
      ? []
      : [{ category, label: copy.t(CATEGORY_LABELS[category]), items: members }];
  });
}

/** The first displayed row, when the current selection is missing or no longer listed. */
export function defaultEntryId(state: AppConfigState): string | undefined {
  const items = listedItems(state.list);
  const { detail } = state;
  if (detail.status !== "idle" && items.some((item) => item.summary.id === detail.id)) {
    return undefined;
  }
  return groupByCategory(items)[0]?.items[0]?.summary.id;
}

export const CAPABILITY_LABELS: Record<AppConfigCapability, MessageKey> = {
  discoverOnly: "appConfig.capability.discoverOnly",
  readOnly: "appConfig.capability.readOnly",
  writable: "appConfig.capability.writable",
};

export type ProbeTone = "neutral" | "success" | "warning" | "danger";

export interface ProbeBadge {
  symbol: string;
  label: string;
  tone: ProbeTone;
}

/** Each state carries a text label and a symbol, so colour is never the only cue. */
export function describeProbe(probe: AppConfigProbeStatus, copy: AppConfigCopy = ZH_COPY): ProbeBadge {
  switch (probe.status) {
    case "found":
      return { symbol: "✓", label: copy.t("appConfig.status.found"), tone: "success" };
    case "notFound":
      return { symbol: "○", label: copy.t("appConfig.status.notFound"), tone: "neutral" };
    case "symlinkOrNonRegular":
      return { symbol: "⚠", label: copy.t("appConfig.status.linkOrSpecial"), tone: "warning" };
    case "inaccessible":
    case "outOfBounds":
      return { symbol: "⊘", label: copy.t("appConfig.status.cannotCheck"), tone: "warning" };
  }
}

export function isFixedLocation(summary: AppConfigEntrySummary): boolean {
  return !summary.displayPath.startsWith("~/");
}

export function fileNameOf(displayPath: string): string {
  const slash = displayPath.lastIndexOf("/");
  return slash === -1 ? displayPath : displayPath.slice(slash + 1);
}

const SHELL_FILE_NAMES = new Set([
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".zlogout",
  ".bashrc",
  ".bash_profile",
  ".profile",
]);

export function codeLanguageFor(
  summary: Pick<AppConfigEntrySummary, "format" | "displayPath">,
): CodeLanguage {
  switch (summary.format) {
    case "json":
    case "jsonc":
      return "json";
    case "toml":
      return "toml";
    case "ini":
      return "ini";
    case "dotenv":
      return "dotenv";
    case "text":
      return languageFromFileName(fileNameOf(summary.displayPath));
    case "plist":
      return "plain";
  }
}

function languageFromFileName(name: string): CodeLanguage {
  const lower = name.toLowerCase();
  if (lower === "caddyfile" || lower.endsWith(".caddyfile")) return "caddyfile";
  if (SHELL_FILE_NAMES.has(lower) || /\.(zsh|sh|bash)$/.test(lower)) return "shell";
  if (lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env")) return "dotenv";
  return "plain";
}

export function formatBytes(size: number, locale: Locale = "zh-CN"): string {
  return formatByteSize(size, locale);
}

export function formatModifiedTime(unixMillis: number, locale: Locale = "zh-CN"): string {
  return formatDateTime(unixMillis, locale);
}

export function metaRows(meta: AppConfigFileMeta, copy: AppConfigCopy = ZH_COPY): Array<[string, string]> {
  return [
    [copy.t("appConfig.meta.size"), formatBytes(meta.size, copy.locale)],
    [copy.t("appConfig.meta.modified"), formatModifiedTime(meta.modifiedUnixMillis, copy.locale)],
  ];
}

const FAILURE_MESSAGES: Record<AppConfigReadFailure, MessageKey> = {
  tooLarge: "appConfig.read.tooLarge",
  parseError: "appConfig.read.parseError",
  unreadable: "appConfig.read.unreadable",
};

const UNAVAILABLE_MESSAGES: Record<
  Exclude<AppConfigProbeStatus["status"], "found">,
  MessageKey
> = {
  notFound: "appConfig.read.notFound",
  symlinkOrNonRegular: "appConfig.read.linkOrSpecial",
  inaccessible: "appConfig.read.inaccessible",
  outOfBounds: "appConfig.read.outOfBounds",
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
  copy: AppConfigCopy = ZH_COPY,
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
        note: metadataNote(summary, copy),
        rows: metaRows(result.meta, copy),
      };
    case "unavailable":
      return { kind: "unavailable", message: copy.t(UNAVAILABLE_MESSAGES[result.status.status]) };
    case "failed":
      return { kind: "failed", message: copy.t(FAILURE_MESSAGES[result.kind]) };
  }
}

function metadataNote(summary: AppConfigEntrySummary, copy: AppConfigCopy): string {
  if (summary.sensitivity === "credentials") {
    return copy.t("appConfig.meta.credentials");
  }
  if (summary.format === "plist" || summary.format === "dotenv") {
    return copy.t("appConfig.meta.unsupportedFormat");
  }
  return copy.t("appConfig.meta.metadataOnly");
}
