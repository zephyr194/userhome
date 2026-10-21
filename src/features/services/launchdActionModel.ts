// Pure logic of the lifecycle action panel: which actions a job offers, how an
// outcome is worded, and the panel's state machine. No component, no IPC.

import type { AppError } from "../../ipc/core";
import type {
  LaunchdAction,
  LaunchdActionExecution,
  LaunchdActionOutcome,
  LaunchdActionPreview,
  LaunchdObservedState,
  LaunchdOwnershipKind,
  LaunchdService,
} from "../../ipc/services";

export const ACTION_LABELS: Readonly<Record<LaunchdAction, string>> = {
  LOAD: "加载",
  START: "启动",
  STOP: "停止",
  RESTART: "重启",
  DISABLE: "禁用自启",
  ENABLE: "启用自启",
  UNLOAD: "卸载",
};

/** One line on what the action is, shown next to its button. */
export const ACTION_HINTS: Readonly<Record<LaunchdAction, string>> = {
  LOAD: "把配置文件交给 launchd 加载（不删除、不修改文件）",
  START: "启动已加载的任务（不会隐式加载）",
  STOP: "停止进程；带 KeepAlive 的任务会被卸载以防被自动拉起",
  RESTART: "结束并重新启动正在运行的实例",
  DISABLE: "禁用登录自动启动（不会停止当前进程）",
  ENABLE: "恢复登录自动启动（不会加载或启动）",
  UNLOAD: "从 launchd 卸载（配置文件保留）",
};

const ACTIONABLE_OWNERSHIPS: readonly LaunchdOwnershipKind[] = [
  "USERHOME_CREATED",
  "USERHOME_ADOPTED",
];

/**
 * Whether the job may have any action at all. The backend's verdict is the only
 * input; a read-only verdict, another domain or any other ownership has none,
 * and the backend refuses such a request again regardless.
 */
export function isActionable(service: LaunchdService): boolean {
  const { ownership } = service;
  return (
    ownership.modifiable &&
    ownership.readOnlyReasons.length === 0 &&
    ACTIONABLE_OWNERSHIPS.includes(ownership.kind) &&
    service.domain === "GUI"
  );
}

/** The actions worth offering for the job's current load and run state. */
export function availableActions(service: LaunchdService): LaunchdAction[] {
  if (!isActionable(service)) return [];
  switch (service.loadState) {
    case "LOADED":
      return [
        ...(service.runState === "RUNNING" ? [] : (["START"] as const)),
        "RESTART",
        "STOP",
        "UNLOAD",
        "DISABLE",
        "ENABLE",
      ];
    case "NOT_LOADED":
      return ["LOAD", "DISABLE", "ENABLE"];
    default:
      return [];
  }
}

/** Why a modifiable job shows no action, when that is the case. */
export function noActionsReason(service: LaunchdService): string | undefined {
  if (!isActionable(service) || availableActions(service).length > 0) {
    return undefined;
  }
  return "加载状态未知或无法访问，暂不提供动作。请先刷新，确认状态后再操作。";
}

// ---- wording ------------------------------------------------------------

export function actionLabel(action: LaunchdAction): string {
  return ACTION_LABELS[action];
}

export type ResultTone = "success" | "warning" | "danger" | "neutral";

export interface ResultPresentation {
  label: string;
  tone: ResultTone;
  /** The state may differ from what the page shows, so offer a refresh. */
  needsRefresh: boolean;
}

export function presentOutcome(
  outcome: LaunchdActionOutcome,
): ResultPresentation {
  switch (outcome) {
    case "SUCCEEDED":
      return { label: "成功", tone: "success", needsRefresh: false };
    case "NO_CHANGE":
      return { label: "无需变更", tone: "neutral", needsRefresh: false };
    case "PARTIAL":
      return { label: "部分完成", tone: "warning", needsRefresh: true };
    case "FAILED":
      return { label: "失败", tone: "danger", needsRefresh: true };
    case "UNKNOWN":
      return { label: "未知", tone: "warning", needsRefresh: true };
    case "CANCELLED":
      return { label: "已取消", tone: "neutral", needsRefresh: false };
  }
}

function flag(
  value: boolean | undefined,
  yes: string,
  no: string,
): string {
  if (value === undefined) return "未知";
  return value ? yes : no;
}

/** The state as read back; a part that could not be read says "未知". */
export function observedLines(observed: LaunchdObservedState): string[] {
  const running =
    observed.running === true && observed.pid !== undefined
      ? `有运行中的进程（PID ${observed.pid}）`
      : flag(observed.running, "有运行中的进程", "没有运行中的进程");
  return [
    `加载：${flag(observed.loaded, "已加载", "未加载")}`,
    `进程：${running}`,
    `登录自动启动：${flag(observed.disabled === undefined ? undefined : !observed.disabled, "已启用", "已禁用")}`,
  ];
}

export function stepStatusText(
  status: LaunchdActionExecution["steps"][number]["status"],
): string {
  switch (status) {
    case "SUCCEEDED":
      return "已执行";
    case "FAILED":
      return "失败";
    case "TIMED_OUT":
      return "超时";
    case "NOT_RUN":
      return "未执行";
  }
}

/** A job UserHome just created, found again in the refreshed list. */
export function findCreatedService(
  services: readonly LaunchdService[],
  label: string,
): LaunchdService | undefined {
  return services.find(
    (service) =>
      service.domain === "GUI" && service.label === label && isActionable(service),
  );
}

// ---- the panel's state machine --------------------------------------------

export type ActionPanelState =
  | { phase: "idle" }
  | { phase: "previewing"; action: LaunchdAction }
  | { phase: "previewed"; preview: LaunchdActionPreview }
  | { phase: "executing"; preview: LaunchdActionPreview }
  | { phase: "done"; execution: LaunchdActionExecution }
  | {
      phase: "error";
      during: "preview" | "execute";
      action: LaunchdAction;
      error: AppError;
    };

export type ActionPanelEvent =
  | { type: "previewStarted"; action: LaunchdAction }
  | { type: "previewed"; preview: LaunchdActionPreview }
  | { type: "executeStarted" }
  | { type: "executed"; execution: LaunchdActionExecution }
  | { type: "failed"; error: AppError }
  | { type: "dismissed" };

export const INITIAL_ACTION_PANEL_STATE: ActionPanelState = { phase: "idle" };

/**
 * One action at a time: a new preview starts only from a settled state, a
 * confirmation only from a shown preview, and a request in flight cannot be
 * dismissed (its result is still coming and must be shown).
 */
export function actionPanelReducer(
  state: ActionPanelState,
  event: ActionPanelEvent,
): ActionPanelState {
  switch (event.type) {
    case "previewStarted":
      return state.phase === "previewing" || state.phase === "executing"
        ? state
        : { phase: "previewing", action: event.action };
    case "previewed":
      return state.phase === "previewing"
        ? { phase: "previewed", preview: event.preview }
        : state;
    case "executeStarted":
      return state.phase === "previewed"
        ? { phase: "executing", preview: state.preview }
        : state;
    case "executed":
      return state.phase === "executing"
        ? { phase: "done", execution: event.execution }
        : state;
    case "failed":
      if (state.phase === "previewing") {
        return {
          phase: "error",
          during: "preview",
          action: state.action,
          error: event.error,
        };
      }
      if (state.phase === "executing") {
        return {
          phase: "error",
          during: "execute",
          action: state.preview.action,
          error: event.error,
        };
      }
      return state;
    case "dismissed":
      return state.phase === "previewing" || state.phase === "executing"
        ? state
        : { phase: "idle" };
  }
}
