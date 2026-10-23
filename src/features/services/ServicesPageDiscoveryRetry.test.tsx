// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleDiscovery } from "./launchdFixtures";
import { ServicesPage } from "./ServicesPage";

const listLaunchdServices = vi.fn();
const listServices = vi.fn();

vi.mock("../../ipc/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/services")>()),
  listLaunchdServices: () => listLaunchdServices(),
  listServices: () => listServices(),
}));

const BUSY = {
  code: "CONFLICT",
  message: "launchd discovery is already running. Retry when it finishes.",
  retryable: false,
};

async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  listServices.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("services page discovery retry", () => {
  it("retries once after a busy read and shows the list", async () => {
    listLaunchdServices
      .mockRejectedValueOnce(BUSY)
      .mockResolvedValueOnce(sampleDiscovery());
    render(<ServicesPage />);
    await settle();

    expect(listLaunchdServices).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await settle();

    expect(listLaunchdServices).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/already running/)).toBeNull();
    expect(screen.getAllByText("example.agent").length).toBeGreaterThan(0);
  });

  it("explains a second busy read in Chinese and offers a retry", async () => {
    listLaunchdServices.mockRejectedValue(BUSY);
    render(<ServicesPage />);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await settle();

    expect(listLaunchdServices).toHaveBeenCalledTimes(2);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("正在被另一处读取");
    expect(alert.textContent).not.toContain("already running");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
