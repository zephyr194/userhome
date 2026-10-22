import type { CaddyWorkdirStatus } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { SelectGrantResult } from "../../ipc/grants";

export type WorkdirLoad =
  | { status: "loading" }
  | { status: "failed"; error: AppError }
  | { status: "ready"; workdir: CaddyWorkdirStatus };

export type WorkdirOperation = "select" | "default" | "revoke";

export type WorkdirAction =
  | { status: "idle" }
  | { status: "confirmRevoke" }
  | { status: "busy"; operation: WorkdirOperation }
  | { status: "notice"; message: string }
  | { status: "failed"; message: string };

export type WorkdirActionEvent =
  | { type: "confirmRevoke" }
  | { type: "cancelRevoke" }
  | { type: "started"; operation: WorkdirOperation }
  | { type: "selected"; result: SelectGrantResult }
  | { type: "revoked" }
  | { type: "failed"; error: AppError };

export const WORKDIR_REQUIRED_REASON = "请先选择工作目录";
const WORKDIR_LOADING_REASON = "正在检查工作目录";
const WORKDIR_UNREADABLE_REASON = "无法读取工作目录状态";

export function workdirBlockReason(load: WorkdirLoad): string | undefined {
  switch (load.status) {
    case "loading":
      return WORKDIR_LOADING_REASON;
    case "failed":
      return WORKDIR_UNREADABLE_REASON;
    case "ready":
      return load.workdir.authorized === undefined ? WORKDIR_REQUIRED_REASON : undefined;
  }
}

// Shown once per session until dismissed; the legacy data is never read or moved.
export function legacyNoticePath(load: WorkdirLoad, dismissed: boolean): string | undefined {
  if (dismissed || load.status !== "ready" || !load.workdir.legacyDataPresent) {
    return undefined;
  }
  return load.workdir.legacyDisplayPath;
}

export function reduceWorkdirAction(
  state: WorkdirAction,
  event: WorkdirActionEvent,
): WorkdirAction {
  switch (event.type) {
    case "confirmRevoke":
      return state.status === "busy" ? state : { status: "confirmRevoke" };
    case "cancelRevoke":
      return { status: "idle" };
    case "started":
      return { status: "busy", operation: event.operation };
    case "selected":
      return {
        status: "notice",
        message:
          event.result.status === "CANCELLED"
            ? "已取消，工作目录未更改。"
            : `已设置工作目录：${event.result.grant.displayPath}`,
      };
    case "revoked":
      return { status: "notice", message: "已撤销工作目录授权。规则文件保留在原目录。" };
    case "failed":
      return { status: "failed", message: event.error.message };
  }
}
