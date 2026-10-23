import { useCallback, useEffect, useReducer, useState } from "react";
import {
  caddyWorkdirRevoke,
  caddyWorkdirSelect,
  caddyWorkdirStatus,
  caddyWorkdirUseDefault,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import {
  legacyNoticePath,
  reduceWorkdirAction,
  workdirBlockReason,
  type WorkdirAction,
  type WorkdirActionEvent,
  type WorkdirLoad,
  type WorkdirOperation,
} from "./caddyWorkdirModel";
import { useCaddyCopy } from "./caddyCopy";

export interface CaddyWorkdirController {
  load: WorkdirLoad;
  action: WorkdirAction;
  legacyPath: string | undefined;
  blockReason: string | undefined;
  refresh: () => void;
  select: () => void;
  useDefault: () => void;
  confirmRevoke: () => void;
  cancelRevoke: () => void;
  revoke: () => void;
  dismissLegacy: () => void;
}

export function useCaddyWorkdir(): CaddyWorkdirController {
  const [load, setLoad] = useState<WorkdirLoad>({ status: "loading" });
  const copy = useCaddyCopy();
  const [action, dispatch] = useReducer(
    (state: WorkdirAction, event: WorkdirActionEvent) => reduceWorkdirAction(state, event, copy),
    { status: "idle" },
  );
  const [legacyDismissed, setLegacyDismissed] = useState(false);

  const refresh = useCallback(() => {
    caddyWorkdirStatus().then(
      (workdir) => setLoad({ status: "ready", workdir }),
      (error: AppError) => setLoad({ status: "failed", error }),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const chooseDirectory = useCallback(
    (operation: Extract<WorkdirOperation, "select" | "default">) => {
      dispatch({ type: "started", operation });
      const request = operation === "select" ? caddyWorkdirSelect() : caddyWorkdirUseDefault();
      request.then(
        (result) => {
          dispatch({ type: "selected", result });
          refresh();
        },
        (error: AppError) => dispatch({ type: "failed", error }),
      );
    },
    [refresh],
  );

  const revoke = useCallback(() => {
    dispatch({ type: "started", operation: "revoke" });
    caddyWorkdirRevoke().then(
      () => {
        dispatch({ type: "revoked" });
        refresh();
      },
      (error: AppError) => dispatch({ type: "failed", error }),
    );
  }, [refresh]);

  return {
    load,
    action,
    legacyPath: legacyNoticePath(load, legacyDismissed),
    blockReason: workdirBlockReason(load, copy),
    refresh,
    select: () => chooseDirectory("select"),
    useDefault: () => chooseDirectory("default"),
    confirmRevoke: () => dispatch({ type: "confirmRevoke" }),
    cancelRevoke: () => dispatch({ type: "cancelRevoke" }),
    revoke,
    dismissLegacy: () => setLegacyDismissed(true),
  };
}
