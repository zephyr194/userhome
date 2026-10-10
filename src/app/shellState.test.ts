import { describe, expect, it } from "vitest";
import type { AppError, AppStatus } from "../ipc/core";
import type { DiscoverySnapshot } from "../ipc/discovery";
import type { OperationDetails } from "../ipc/operations";
import { DEFAULT_USER_PREFERENCES } from "../ipc/settings";
import { initialShellState, shellReducer } from "./shellState";

const appStatus: AppStatus = {
  status: "ok",
  version: "0.1.0",
};

const applications = {
  schemaVersion: 1 as const,
  coveragePolicy: {
    priorityATotal: 6,
    priorityAUsable: 6,
    priorityBTotal: 20,
    priorityBCovered: 20,
    minimumEligibleTextPercent: 90,
  },
  applications: [],
};

const operation: OperationDetails = {
  operationId: "operation-1",
  summary: "刷新本机状态",
  effects: [],
  requiresElevation: false,
  expiresAt: "2026-09-20T10:00:00Z",
  status: "SUCCEEDED",
  events: [],
};

const error: AppError = {
  code: "INTERNAL",
  message: "本地服务暂时不可用。",
  retryable: true,
};

describe("shellReducer", () => {
  it("tracks the application catalog independently", () => {
    const ready = shellReducer(initialShellState, {
      type: "applications-ready",
      catalog: applications,
    });
    const failedConnection = shellReducer(ready, {
      type: "connection-error",
      error,
    });

    expect(failedConnection.applications).toEqual({
      status: "ready",
      catalog: applications,
    });
  });

  it("preserves operation data when the connection request fails", () => {
    const withOperation = shellReducer(initialShellState, {
      type: "operation-ready",
      operation,
    });
    const failedConnection = shellReducer(withOperation, {
      type: "connection-error",
      error,
    });

    expect(failedConnection.connection).toEqual({ status: "error", error });
    expect(failedConnection.recentOperation).toEqual({
      status: "ready",
      operation,
    });
  });

  it("preserves connection data when the operation request fails", () => {
    const withConnection = shellReducer(initialShellState, {
      type: "connection-ready",
      appStatus,
    });
    const failedOperation = shellReducer(withConnection, {
      type: "operation-error",
      error,
    });

    expect(failedOperation.connection).toEqual({
      status: "ready",
      appStatus,
    });
    expect(failedOperation.recentOperation).toEqual({
      status: "error",
      error,
    });
  });

  it("tracks refresh progress and completion independently", () => {
    const refreshing = shellReducer(initialShellState, {
      type: "refresh-started",
    });
    const ready = shellReducer(refreshing, {
      type: "refresh-finished",
      completedAt: "2026-09-20T09:30:00Z",
    });

    expect(refreshing.refresh).toEqual({ status: "refreshing" });
    expect(ready.refresh).toEqual({
      status: "ready",
      completedAt: "2026-09-20T09:30:00Z",
    });
  });

  it("exposes validated and safe-default preference hydration states", () => {
    const ready = shellReducer(initialShellState, {
      type: "preferences-ready",
      preferences: DEFAULT_USER_PREFERENCES,
    });
    const recovered = shellReducer(initialShellState, {
      type: "preferences-safe-default",
      preferences: DEFAULT_USER_PREFERENCES,
      diagnostic: {
        code: "INVALID_DOCUMENT",
        message: "Preferences are invalid; safe defaults are active.",
      },
    });

    expect(ready.preferences.status).toBe("ready");
    expect(recovered.preferences).toMatchObject({
      status: "safe-default",
      preferences: DEFAULT_USER_PREFERENCES,
      diagnostic: { code: "INVALID_DOCUMENT" },
    });
  });
});

describe("shellReducer discovery retention", () => {
  const snapshot: DiscoverySnapshot = {
    refreshId: "refresh-1",
    startedAtEpochMs: 1,
    system: { status: "LOADING" },
    brew: { status: "LOADING" },
    candidates: { status: "LOADING" },
  };

  it("retains the previous snapshot when a refresh fails", () => {
    const ready = shellReducer(initialShellState, {
      type: "discovery-ready",
      snapshot,
    });
    const failed = shellReducer(ready, {
      type: "discovery-error",
      error,
    });

    expect(failed.discovery).toEqual({
      status: "error",
      error,
      previousSnapshot: snapshot,
    });
  });

  it("keeps the retained snapshot across repeated refresh failures", () => {
    const ready = shellReducer(initialShellState, {
      type: "discovery-ready",
      snapshot,
    });
    const first = shellReducer(ready, { type: "discovery-error", error });
    const second = shellReducer(first, {
      type: "discovery-error",
      error: { ...error, message: "again" },
    });

    expect(second.discovery).toMatchObject({
      status: "error",
      previousSnapshot: snapshot,
    });
  });

  it("does not invent a previous snapshot before any discovery succeeds", () => {
    const failed = shellReducer(initialShellState, {
      type: "discovery-error",
      error,
    });

    expect(failed.discovery).toEqual({ status: "error", error });
  });
});
