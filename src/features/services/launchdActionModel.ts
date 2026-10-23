// Pure logic of the lifecycle action panel: which actions a job offers, how an
// outcome is worded, and the panel's state machine. No component, no IPC.

import type { MessageKey, TranslateFunction } from "../../i18n";
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

export const ACTION_LABEL_KEYS: Readonly<Record<LaunchdAction, MessageKey>> = {
  LOAD: "services.action.label.LOAD",
  START: "services.action.label.START",
  STOP: "services.action.label.STOP",
  RESTART: "services.action.label.RESTART",
  DISABLE: "services.action.label.DISABLE",
  ENABLE: "services.action.label.ENABLE",
  UNLOAD: "services.action.label.UNLOAD",
};

/** One line on what the action is, shown next to its button. */
export const ACTION_HINT_KEYS: Readonly<Record<LaunchdAction, MessageKey>> = {
  LOAD: "services.action.hint.LOAD",
  START: "services.action.hint.START",
  STOP: "services.action.hint.STOP",
  RESTART: "services.action.hint.RESTART",
  DISABLE: "services.action.hint.DISABLE",
  ENABLE: "services.action.hint.ENABLE",
  UNLOAD: "services.action.hint.UNLOAD",
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
export function noActionsReason(
  service: LaunchdService,
  t: TranslateFunction,
): string | undefined {
  if (!isActionable(service) || availableActions(service).length > 0) {
    return undefined;
  }
  return t("services.action.noneReason");
}

// ---- wording ------------------------------------------------------------

export function actionLabel(action: LaunchdAction, t: TranslateFunction): string {
  return t(ACTION_LABEL_KEYS[action]);
}

export function actionHint(action: LaunchdAction, t: TranslateFunction): string {
  return t(ACTION_HINT_KEYS[action]);
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
  t: TranslateFunction,
): ResultPresentation {
  switch (outcome) {
    case "SUCCEEDED":
      return { label: t("services.outcome.succeeded"), tone: "success", needsRefresh: false };
    case "NO_CHANGE":
      return { label: t("services.outcome.noChange"), tone: "neutral", needsRefresh: false };
    case "PARTIAL":
      return { label: t("services.outcome.partial"), tone: "warning", needsRefresh: true };
    case "FAILED":
      return { label: t("services.outcome.failed"), tone: "danger", needsRefresh: true };
    case "UNKNOWN":
      return { label: t("services.outcome.unknown"), tone: "warning", needsRefresh: true };
    case "CANCELLED":
      return { label: t("services.outcome.cancelled"), tone: "neutral", needsRefresh: false };
  }
}

/** The state as read back; a part that could not be read says "未知". */
export function observedLines(
  observed: LaunchdObservedState,
  t: TranslateFunction,
): string[] {
  const unknown = t("services.observed.unknown");
  const loaded =
    observed.loaded === undefined
      ? unknown
      : observed.loaded
        ? t("services.observed.loaded")
        : t("services.observed.notLoaded");
  const running =
    observed.running === true && observed.pid !== undefined
      ? t("services.observed.runningPid", { pid: observed.pid })
      : observed.running === undefined
        ? unknown
        : observed.running
          ? t("services.observed.running")
          : t("services.observed.notRunning");
  const loginEnabled =
    observed.disabled === undefined
      ? unknown
      : !observed.disabled
        ? t("services.observed.enabled")
        : t("services.observed.disabled");
  return [
    t("services.observed.loadedLine", { value: loaded }),
    t("services.observed.processLine", { value: running }),
    t("services.observed.loginLine", { value: loginEnabled }),
  ];
}

export function stepStatusText(
  status: LaunchdActionExecution["steps"][number]["status"],
  t: TranslateFunction,
): string {
  switch (status) {
    case "SUCCEEDED":
      return t("services.step.succeeded");
    case "FAILED":
      return t("services.step.failed");
    case "TIMED_OUT":
      return t("services.step.timedOut");
    case "NOT_RUN":
      return t("services.step.notRun");
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

export function findServiceByFocus(
  services: readonly LaunchdService[],
  focus: { label: string; domain: LaunchdService["domain"] },
): LaunchdService | undefined {
  return services.find(
    (service) => service.domain === focus.domain && service.label === focus.label,
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
