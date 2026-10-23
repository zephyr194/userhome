import type { TranslateFunction } from "../../i18n";
import type { AppError } from "../../ipc/core";
import type { AdoptExecution, AdoptPreview } from "../../ipc/servicesAdopt";
import type { LaunchdService } from "../../ipc/services";
import { readOnlyReasonText } from "./launchdModel";

/**
 * Which adoption or edit entry a job offers, decided from the backend's
 * ownership verdict alone. Only the current user's own jobs can be adopted;
 * only UserHome's adopted jobs can be edited or released. Everything else has no
 * entry at all.
 */
export type ManagementView =
  | { readonly kind: "none" }
  | { readonly kind: "adopt" }
  | { readonly kind: "adoptBlocked"; readonly reasons: readonly string[] }
  | { readonly kind: "adopted"; readonly editBlockers: readonly string[] };

/** Why the job cannot be adopted; empty when the job may be offered for adoption. */
export function adoptionBlockers(service: LaunchdService, t: TranslateFunction): string[] {
  const reasons: string[] = [];
  if (service.domain !== "GUI") {
    reasons.push(t("services.dialog.adopt.blocker.domain"));
  }
  if (service.configFiles.length !== 1) {
    reasons.push(t("services.dialog.adopt.blocker.configFiles"));
  }
  for (const reason of service.ownership.readOnlyReasons) {
    if (reason !== "NOT_ADOPTED") reasons.push(readOnlyReasonText(reason, t));
  }
  return reasons;
}

/** Why an adopted job cannot be edited; empty when a structured edit may be offered. */
export function editBlockers(service: LaunchdService, t: TranslateFunction): string[] {
  const reasons: string[] = [];
  if (!service.ownership.modifiable) {
    reasons.push(...service.ownership.readOnlyReasons.map((reason) => readOnlyReasonText(reason, t)));
  }
  if (service.domain !== "GUI") {
    reasons.push(t("services.dialog.edit.blocker.domain"));
  }
  const [file, ...others] = service.configFiles;
  if (file === undefined || others.length > 0) {
    reasons.push(t("services.dialog.edit.blocker.configFiles"));
  } else if (file.details === undefined) {
    reasons.push(t("services.dialog.edit.blocker.unreadable"));
  } else {
    if (file.details.program !== undefined) {
      reasons.push(t("services.dialog.edit.blocker.programKey"));
    }
    if (file.details.argumentsTruncated) {
      reasons.push(t("services.dialog.edit.blocker.argumentsTruncated"));
    }
  }
  return reasons;
}

export function managementOf(service: LaunchdService, t: TranslateFunction): ManagementView {
  switch (service.ownership.kind) {
    case "CURRENT_USER_AGENT": {
      const reasons = adoptionBlockers(service, t);
      return reasons.length === 0
        ? { kind: "adopt" }
        : { kind: "adoptBlocked", reasons };
    }
    case "USERHOME_ADOPTED":
      return { kind: "adopted", editBlockers: editBlockers(service, t) };
    default:
      return { kind: "none" };
  }
}

// ---- the adoption flow ----------------------------------------------------

export type AdoptFlowState =
  | { readonly phase: "idle" }
  | { readonly phase: "previewing" }
  | { readonly phase: "previewed"; readonly preview: AdoptPreview }
  | { readonly phase: "executing"; readonly preview: AdoptPreview }
  | { readonly phase: "done"; readonly execution: AdoptExecution }
  | {
      readonly phase: "failed";
      readonly error: AppError;
      readonly preview?: AdoptPreview;
    };

export type AdoptFlowAction =
  | { readonly type: "previewRequested" }
  | { readonly type: "previewLoaded"; readonly preview: AdoptPreview }
  | { readonly type: "previewFailed"; readonly error: AppError }
  | { readonly type: "confirmRequested" }
  | { readonly type: "executed"; readonly execution: AdoptExecution }
  | { readonly type: "executeFailed"; readonly error: AppError };

export const INITIAL_ADOPT_FLOW: AdoptFlowState = { phase: "idle" };

/** Events that do not fit the current phase leave the state as it is. */
export function adoptFlowReducer(
  state: AdoptFlowState,
  action: AdoptFlowAction,
): AdoptFlowState {
  switch (action.type) {
    case "previewRequested":
      return state.phase === "idle" || state.phase === "failed"
        ? { phase: "previewing" }
        : state;
    case "previewLoaded":
      return state.phase === "previewing"
        ? { phase: "previewed", preview: action.preview }
        : state;
    case "previewFailed":
      return state.phase === "previewing"
        ? { phase: "failed", error: action.error }
        : state;
    case "confirmRequested":
      return state.phase === "previewed"
        ? { phase: "executing", preview: state.preview }
        : state;
    case "executed":
      return state.phase === "executing"
        ? { phase: "done", execution: action.execution }
        : state;
    case "executeFailed":
      return state.phase === "executing"
        ? { phase: "failed", error: action.error, preview: state.preview }
        : state;
  }
}

export interface NoticeText {
  readonly title: string;
  readonly detail: string;
}

/**
 * The backend's error category decides the wording; a permission refusal
 * carries the backend's own per-reason text, since that is the one place the
 * refusal categories are named.
 */
export function describeAdoptFailure(error: AppError, t: TranslateFunction): NoticeText {
  switch (error.code) {
    case "NOT_FOUND":
      return {
        title: t("services.dialog.adopt.failure.notFound.title"),
        detail: t("services.dialog.adopt.failure.notFound.detail"),
      };
    case "CONFLICT":
      return {
        title: t("services.dialog.adopt.failure.conflict.title"),
        detail: error.message,
      };
    case "PERMISSION_DENIED":
      return {
        title: t("services.dialog.adopt.failure.permission.title"),
        detail: error.message,
      };
    case "VALIDATION_FAILED":
      return {
        title: t("services.dialog.adopt.failure.validation.title"),
        detail: error.message,
      };
    default:
      return { title: t("services.dialog.adopt.failure.default.title"), detail: error.message };
  }
}

export function describeAdoptSuccess(
  execution: AdoptExecution,
  t: TranslateFunction,
): NoticeText {
  return {
    title: t("services.dialog.adopt.success.title", { label: execution.label }),
    detail: t("services.dialog.adopt.success.detail", {
      backupId: execution.backupId,
      effectNote: execution.effectNote,
    }),
  };
}
