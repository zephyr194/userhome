// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../test/deferred";
import { renderStrict } from "../../test/renderStrict";
import { sampleDiscovery } from "./launchdFixtures";
import { ServicesPage } from "./ServicesPage";

// Stands in for the Tauri backend one level below `ipc/services`, so the real
// `listLaunchdServices` (and its single flight) runs. The backend admits one
// launchd discovery at a time: a second one while the first runs is refused.
const backend = vi.fn<(command: string) => Promise<unknown>>();

vi.mock("../../ipc/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/core")>()),
  invokeCommand: (command: string) => backend(command),
}));

const BUSY = {
  code: "CONFLICT",
  message: "launchd discovery is already running. Retry when it finishes.",
  retryable: false,
};

async function settle() {
  await act(async () => {});
}

function discoveryCalls(): number {
  return backend.mock.calls.filter(([command]) => command === "list_launchd_services")
    .length;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  backend.mockReset();
});

describe("services page under StrictMode", () => {
  it("reads the launchd list once and shows it, not a refused second read", async () => {
    const discovery = deferred<unknown>();
    let running = false;
    backend.mockImplementation((command) => {
      if (command === "list_services") return Promise.resolve([]);
      if (command !== "list_launchd_services") {
        return Promise.reject(new Error(`unexpected command ${command}`));
      }
      if (running) return Promise.reject(BUSY);
      running = true;
      return discovery.promise.finally(() => {
        running = false;
      });
    });

    renderStrict(<ServicesPage />);
    await settle();

    // Mount, cleanup and mount again started two page reads; the backend must
    // have seen only one of them.
    expect(discoveryCalls()).toBe(1);

    discovery.resolve(sampleDiscovery());
    await settle();

    // The list shows without waiting for a busy-retry timer.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("example.agent").length).toBeGreaterThan(0);
    expect(discoveryCalls()).toBe(1);
  });
});
