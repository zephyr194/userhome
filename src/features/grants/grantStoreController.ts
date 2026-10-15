import { decodeAppError, type AppErrorCode } from "../../ipc/core";
import type {
  GrantStoreProblem,
  GrantStoreReset,
  GrantStoreStatus,
} from "../../ipc/grants";

export interface ResetFailure {
  readonly code: AppErrorCode;
  readonly message: string;
}

export type GrantStoreCheck =
  | { readonly phase: "checking" }
  | { readonly phase: "available" }
  | { readonly phase: "unavailable"; readonly reason: GrantStoreProblem }
  | { readonly phase: "check-failed" };

export type GrantStoreDialog =
  | { readonly phase: "closed" }
  | { readonly phase: "asking" }
  | { readonly phase: "resetting" }
  | { readonly phase: "failed"; readonly failure: ResetFailure };

export interface GrantStoreNoticeState {
  readonly check: GrantStoreCheck;
  readonly rechecking: boolean;
  readonly dialog: GrantStoreDialog;
  readonly completed?: GrantStoreReset;
}

export interface GrantStoreController {
  getState: () => GrantStoreNoticeState;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
  confirmReset: () => Promise<void>;
  dismissCompleted: () => void;
}

export function isResettable(reason: GrantStoreProblem): boolean {
  return reason === "CORRUPT" || reason === "NEWER_VERSION";
}

export function isGrantStoreNoticeVisible(state: GrantStoreNoticeState): boolean {
  return (
    state.check.phase === "unavailable" ||
    state.check.phase === "check-failed" ||
    state.dialog.phase !== "closed" ||
    state.completed !== undefined
  );
}

/**
 * Framework-free state machine behind the authorization-store notice. It only
 * reads the status when asked and calls `reset` from `confirmReset`, which the
 * UI reaches solely through the confirmation dialog.
 */
export function createGrantStoreController(deps: {
  getStatus: () => Promise<GrantStoreStatus>;
  reset: () => Promise<GrantStoreReset>;
}): GrantStoreController {
  let state: GrantStoreNoticeState = {
    check: { phase: "checking" },
    rechecking: false,
    dialog: { phase: "closed" },
  };
  let latestCheck = 0;
  const listeners = new Set<() => void>();

  function update(patch: Partial<GrantStoreNoticeState>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  async function refresh(): Promise<void> {
    const ticket = ++latestCheck;
    update({ rechecking: true });
    let check: GrantStoreCheck;
    try {
      const status = await deps.getStatus();
      check =
        status.status === "AVAILABLE"
          ? { phase: "available" }
          : { phase: "unavailable", reason: status.reason };
    } catch {
      check = { phase: "check-failed" };
    }
    // A newer check owns the result; an older answer must not overwrite it.
    if (ticket === latestCheck) {
      update({ check, rechecking: false });
    }
  }

  function openDialog() {
    if (
      state.dialog.phase === "closed" &&
      state.check.phase === "unavailable" &&
      isResettable(state.check.reason)
    ) {
      update({ dialog: { phase: "asking" } });
    }
  }

  function closeDialog() {
    const { dialog } = state;
    if (dialog.phase === "asking") {
      update({ dialog: { phase: "closed" } });
    } else if (dialog.phase === "failed") {
      // A failed reset may still have moved the file aside (partial failure),
      // so look at the store again instead of trusting the old reading.
      update({ dialog: { phase: "closed" } });
      void refresh();
    }
  }

  async function confirmReset(): Promise<void> {
    if (state.dialog.phase !== "asking" && state.dialog.phase !== "failed") {
      return;
    }
    update({ dialog: { phase: "resetting" } });
    let result: GrantStoreReset;
    try {
      result = await deps.reset();
    } catch (error) {
      const { code, message } = decodeAppError(error);
      update({ dialog: { phase: "failed", failure: { code, message } } });
      return;
    }
    update({
      check: { phase: "checking" },
      dialog: { phase: "closed" },
      completed: result,
    });
    await refresh();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    openDialog,
    closeDialog,
    confirmReset,
    dismissCompleted: () => update({ completed: undefined }),
  };
}
