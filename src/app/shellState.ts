import type { AppError, AppStatus } from "../ipc/core";
import type { DiscoverySnapshot } from "../ipc/discovery";
import type { OperationDetails } from "../ipc/operations";
import type { SettingsDiagnostic, UserPreferences } from "../ipc/settings";

export type ConnectionState =
  | { status: "loading" }
  | { status: "ready"; appStatus: AppStatus }
  | { status: "error"; error: AppError };

export type RecentOperationState =
  | { status: "loading" }
  | { status: "ready"; operation: OperationDetails }
  | { status: "empty" }
  | { status: "error"; error: AppError };

export type RefreshState =
  | { status: "idle" }
  | { status: "refreshing" }
  | { status: "ready"; completedAt: string }
  | { status: "error"; message: string };

export type DiscoveryState =
  | { status: "loading" }
  | { status: "ready"; snapshot: DiscoverySnapshot }
  | {
      status: "error";
      error: AppError;
      previousSnapshot?: DiscoverySnapshot;
    };

export type PreferencesState =
  | { status: "loading" }
  | { status: "ready"; preferences: UserPreferences }
  | {
      status: "safe-default";
      preferences: UserPreferences;
      diagnostic: SettingsDiagnostic;
    };

export interface ShellState {
  connection: ConnectionState;
  discovery: DiscoveryState;
  preferences: PreferencesState;
  recentOperation: RecentOperationState;
  refresh: RefreshState;
}

export const initialShellState: ShellState = {
  connection: { status: "loading" },
  discovery: { status: "loading" },
  preferences: { status: "loading" },
  recentOperation: { status: "loading" },
  refresh: { status: "idle" },
};

export type ShellAction =
  | { type: "connection-loading" }
  | { type: "connection-ready"; appStatus: AppStatus }
  | { type: "connection-error"; error: AppError }
  | { type: "discovery-loading" }
  | { type: "discovery-ready"; snapshot: DiscoverySnapshot }
  | {
      type: "discovery-error";
      error: AppError;
      previousSnapshot?: DiscoverySnapshot;
    }
  | { type: "preferences-ready"; preferences: UserPreferences }
  | {
      type: "preferences-safe-default";
      preferences: UserPreferences;
      diagnostic: SettingsDiagnostic;
    }
  | { type: "operation-loading" }
  | { type: "operation-ready"; operation: OperationDetails }
  | { type: "operation-empty" }
  | { type: "operation-error"; error: AppError }
  | { type: "refresh-started" }
  | { type: "refresh-finished"; completedAt: string }
  | { type: "refresh-error"; message: string };

export function shellReducer(
  state: ShellState,
  action: ShellAction,
): ShellState {
  switch (action.type) {
    case "connection-loading":
      return { ...state, connection: { status: "loading" } };
    case "connection-ready":
      return {
        ...state,
        connection: { status: "ready", appStatus: action.appStatus },
      };
    case "connection-error":
      return {
        ...state,
        connection: { status: "error", error: action.error },
      };
    case "discovery-loading":
      return { ...state, discovery: { status: "loading" } };
    case "discovery-ready":
      return {
        ...state,
        discovery: { status: "ready", snapshot: action.snapshot },
      };
    case "discovery-error": {
      const previousSnapshot =
        action.previousSnapshot ??
        (state.discovery.status === "ready"
          ? state.discovery.snapshot
          : state.discovery.status === "error"
            ? state.discovery.previousSnapshot
            : undefined);
      return {
        ...state,
        discovery: previousSnapshot
          ? { status: "error", error: action.error, previousSnapshot }
          : { status: "error", error: action.error },
      };
    }
    case "preferences-ready":
      return {
        ...state,
        preferences: { status: "ready", preferences: action.preferences },
      };
    case "preferences-safe-default":
      return {
        ...state,
        preferences: {
          status: "safe-default",
          preferences: action.preferences,
          diagnostic: action.diagnostic,
        },
      };
    case "operation-loading":
      return { ...state, recentOperation: { status: "loading" } };
    case "operation-ready":
      return {
        ...state,
        recentOperation: { status: "ready", operation: action.operation },
      };
    case "operation-empty":
      return { ...state, recentOperation: { status: "empty" } };
    case "operation-error":
      return {
        ...state,
        recentOperation: { status: "error", error: action.error },
      };
    case "refresh-started":
      return { ...state, refresh: { status: "refreshing" } };
    case "refresh-finished":
      return {
        ...state,
        refresh: { status: "ready", completedAt: action.completedAt },
      };
    case "refresh-error":
      return {
        ...state,
        refresh: { status: "error", message: action.message },
      };
  }
}
