// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { DEFAULT_USER_PREFERENCES, type LoadedPreferences } from "./ipc/settings";
import type { DiscoverySnapshot } from "./ipc/discovery";

const mocks = vi.hoisted(() => ({
  getSystemSnapshot: vi.fn(),
  refreshSystemSnapshot: vi.fn(),
  getAppStatus: vi.fn(),
  listOperations: vi.fn(),
}));

vi.mock("./ipc/discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ipc/discovery")>()),
  getSystemSnapshot: mocks.getSystemSnapshot,
  refreshSystemSnapshot: mocks.refreshSystemSnapshot,
}));
vi.mock("./ipc/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ipc/core")>()),
  getAppStatus: mocks.getAppStatus,
}));
vi.mock("./ipc/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ipc/operations")>()),
  listOperations: mocks.listOperations,
}));
vi.mock("./app/refreshEvents", () => ({
  registerRefreshRequestListener: () => Promise.resolve(() => undefined),
}));
vi.mock("./app/AppShell", () => ({
  AppShell: ({ state }: { state: { discovery: unknown } }) => (
    <pre data-testid="discovery">{JSON.stringify(state.discovery)}</pre>
  ),
}));

const LOADING_LOCAL_SNAPSHOT: DiscoverySnapshot = {
  refreshId: "first-read",
  startedAtEpochMs: 1,
  system: {
    status: "READY",
    data: {
      completeness: "COMPLETE",
      homeDirectory: "~",
      applications: [],
      issues: [],
    },
  },
  brew: { status: "LOADING" },
  candidates: { status: "LOADING" },
};

const READY_SNAPSHOT: DiscoverySnapshot = {
  refreshId: "refreshed",
  startedAtEpochMs: 2,
  completedAtEpochMs: 3,
  system: LOADING_LOCAL_SNAPSHOT.system,
  brew: {
    status: "READY",
    data: { available: true, formulaCount: 0, caskCount: 0 },
  },
  candidates: {
    status: "READY",
    data: {
      completeness: "COMPLETE",
      candidates: [],
      summary: {
        candidateCount: 0,
        metadataCount: 0,
        rootCount: 0,
        elapsedMs: 0,
        limits: {
          maxCandidates: 0,
          maxEntriesPerRoot: 0,
          maxMetadataCount: 0,
          maxRootDepth: 0,
          timeoutMs: 0,
        },
        outcomes: [],
      },
      issues: [],
    },
  },
};

const ALL_READY_SNAPSHOT: DiscoverySnapshot = {
  ...READY_SNAPSHOT,
  refreshId: "all-ready",
};

const initialPreferences: LoadedPreferences = {
  preferences: { ...DEFAULT_USER_PREFERENCES, refreshOnLaunch: false },
};

function renderApp() {
  return render(<App initialPreferences={initialPreferences} />);
}

function readDiscovery(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("discovery").textContent ?? "{}");
}

beforeEach(() => {
  mocks.getSystemSnapshot.mockReset();
  mocks.refreshSystemSnapshot.mockReset();
  mocks.getAppStatus.mockReset().mockResolvedValue({ status: "ok", version: "1.0.0" });
  mocks.listOperations.mockReset().mockResolvedValue([]);
});

afterEach(cleanup);

describe("App launch without refreshOnLaunch", () => {
  it("refreshes once when the first snapshot still has a LOADING provider module", async () => {
    mocks.getSystemSnapshot.mockResolvedValue(LOADING_LOCAL_SNAPSHOT);
    mocks.refreshSystemSnapshot.mockResolvedValue(READY_SNAPSHOT);

    renderApp();

    await waitFor(() =>
      expect(readDiscovery()).toMatchObject({
        status: "ready",
        snapshot: { refreshId: "refreshed" },
      }),
    );
    expect(mocks.refreshSystemSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when every provider module is already READY", async () => {
    mocks.getSystemSnapshot.mockResolvedValue(ALL_READY_SNAPSHOT);

    renderApp();

    await waitFor(() =>
      expect(readDiscovery()).toMatchObject({
        status: "ready",
        snapshot: { refreshId: "all-ready" },
      }),
    );
    expect(mocks.refreshSystemSnapshot).not.toHaveBeenCalled();
  });

  it("reports a discovery error and keeps the first snapshot when the follow-up refresh fails", async () => {
    mocks.getSystemSnapshot.mockResolvedValue(LOADING_LOCAL_SNAPSHOT);
    mocks.refreshSystemSnapshot.mockRejectedValue({
      code: "INTERNAL",
      message: "refresh failed",
      retryable: false,
    });

    renderApp();

    await waitFor(() => expect(readDiscovery().status).toBe("error"));
    expect(mocks.refreshSystemSnapshot).toHaveBeenCalledTimes(1);
    expect(readDiscovery().previousSnapshot).toMatchObject({ refreshId: "first-read" });
  });
});
