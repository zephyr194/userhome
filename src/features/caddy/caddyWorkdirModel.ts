import type { CaddyWorkdirStatus } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { SelectGrantResult } from "../../ipc/grants";
import { localizeAppErrorMessage } from "../../i18n/errors";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

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

export function workdirBlockReason(
  load: WorkdirLoad,
  copy: CaddyCopy = ZH_COPY,
): string | undefined {
  switch (load.status) {
    case "loading":
      return copy.t("caddy.workdir.checkingReason");
    case "failed":
      return copy.t("caddy.workdir.unreadableReason");
    case "ready":
      return load.workdir.authorized === undefined
        ? copy.t("caddy.workdir.required")
        : undefined;
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
  copy: CaddyCopy = ZH_COPY,
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
            ? copy.t("caddy.workdir.cancelledUnchanged")
            : copy.t("caddy.workdir.set", { path: event.result.grant.displayPath }),
      };
    case "revoked":
      return { status: "notice", message: copy.t("caddy.workdir.revoked") };
    case "failed":
      return {
        status: "failed",
        message: localizeAppErrorMessage(event.error, copy.locale),
      };
  }
}
