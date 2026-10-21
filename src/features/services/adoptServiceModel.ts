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
export function adoptionBlockers(service: LaunchdService): string[] {
  const reasons: string[] = [];
  if (service.domain !== "GUI") {
    reasons.push("只能接管当前用户会话域中的任务。");
  }
  if (service.configFiles.length !== 1) {
    reasons.push("任务没有配置文件或有多个配置文件，无法确定接管哪一个。");
  }
  for (const reason of service.ownership.readOnlyReasons) {
    if (reason !== "NOT_ADOPTED") reasons.push(readOnlyReasonText(reason));
  }
  return reasons;
}

/** Why an adopted job cannot be edited; empty when a structured edit may be offered. */
export function editBlockers(service: LaunchdService): string[] {
  const reasons: string[] = [];
  if (!service.ownership.modifiable) {
    reasons.push(...service.ownership.readOnlyReasons.map(readOnlyReasonText));
  }
  if (service.domain !== "GUI") {
    reasons.push("只能编辑当前用户会话域中的任务。");
  }
  const [file, ...others] = service.configFiles;
  if (file === undefined || others.length > 0) {
    reasons.push("任务没有配置文件或有多个配置文件，无法编辑。");
  } else if (file.details === undefined) {
    reasons.push("无法读取配置内容，不能编辑。");
  } else {
    if (file.details.program !== undefined) {
      reasons.push("配置使用 Program 键指定程序，结构化编辑不支持。");
    }
    if (file.details.argumentsTruncated) {
      reasons.push("参数列表过长，结构化编辑不支持。");
    }
  }
  return reasons;
}

export function managementOf(service: LaunchdService): ManagementView {
  switch (service.ownership.kind) {
    case "CURRENT_USER_AGENT": {
      const reasons = adoptionBlockers(service);
      return reasons.length === 0
        ? { kind: "adopt" }
        : { kind: "adoptBlocked", reasons };
    }
    case "USERHOME_ADOPTED":
      return { kind: "adopted", editBlockers: editBlockers(service) };
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
export function describeAdoptFailure(error: AppError): NoticeText {
  switch (error.code) {
    case "NOT_FOUND":
      return {
        title: "任务已不存在，没有接管",
        detail: "请刷新清单后重新选择任务。",
      };
    case "CONFLICT":
      return {
        title: "任务或 plist 在预览后已变化，没有接管",
        detail: error.message,
      };
    case "PERMISSION_DENIED":
      return {
        title: "接管被拒绝，没有写入任何记录",
        detail: error.message,
      };
    case "VALIDATION_FAILED":
      return {
        title: "接管未完成，没有保留接管记录",
        detail: error.message,
      };
    default:
      return { title: "接管被拒绝", detail: error.message };
  }
}

export function describeAdoptSuccess(execution: AdoptExecution): NoticeText {
  return {
    title: `已接管 ${execution.label}`,
    detail: `原始 plist 已备份为 ${execution.backupId}，接管记录已回读确认。${execution.effectNote}`,
  };
}
