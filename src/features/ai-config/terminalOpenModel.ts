import type { TranslateFunction } from "../../i18n";
import type { AppError } from "../../ipc/core";
import { zhT } from "./aiConfigModel";

export type TerminalOpenState =
  | { readonly status: "idle" }
  | { readonly status: "confirming" }
  | { readonly status: "opening" }
  | { readonly status: "opened" }
  | { readonly status: "failed"; readonly error: AppError };

export type TerminalOpenEvent =
  | { readonly type: "request" }
  | { readonly type: "cancel" }
  | { readonly type: "confirm" }
  | { readonly type: "succeeded" }
  | { readonly type: "failed"; readonly error: AppError };

export const TERMINAL_IDLE: TerminalOpenState = { status: "idle" };

export type TerminalCommandSource =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly built: { readonly placeholders: readonly string[] } }
  | { readonly status: "failed"; readonly error: AppError };

/** Why the command cannot be opened in Terminal right now, or null when it can. */
export function terminalBlockReason(
  source: TerminalCommandSource,
  t: TranslateFunction = zhT,
): string | null {
  switch (source.status) {
    case "ready":
      return source.built.placeholders.length > 0
        ? t("aiConfig.terminal.placeholders")
        : null;
    case "idle":
      return source.message;
    case "loading":
      return t("aiConfig.terminal.generating");
    case "failed":
      return source.error.message;
  }
}

/**
 * A command reaches Terminal only through an explicit confirm step; events that do
 * not fit the current state leave it unchanged, so a stale callback cannot reopen it.
 */
export function reduceTerminalOpen(
  state: TerminalOpenState,
  event: TerminalOpenEvent,
): TerminalOpenState {
  switch (event.type) {
    case "request":
      return state.status === "idle" || state.status === "opened" || state.status === "failed"
        ? { status: "confirming" }
        : state;
    case "cancel":
      return state.status === "confirming" ? TERMINAL_IDLE : state;
    case "confirm":
      return state.status === "confirming" ? { status: "opening" } : state;
    case "succeeded":
      return state.status === "opening" ? { status: "opened" } : state;
    case "failed":
      return state.status === "opening" ? { status: "failed", error: event.error } : state;
  }
}
