// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogSnapshot } from "../../ipc/services";
import { deferred } from "../../test/deferred";
import { configFile, launchdService } from "./launchdFixtures";
import { LOG_POLL_INTERVAL_MS } from "./logTailModel";
import { ServiceLogs } from "./ServiceLogs";

const authorizeLaunchdLog = vi.fn();
const readLaunchdLogTail = vi.fn();
const readLaunchdLogSince = vi.fn();
const revokeLaunchdLog = vi.fn();

vi.mock("../../ipc/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/services")>()),
  authorizeLaunchdLog: (...args: unknown[]) => authorizeLaunchdLog(...args),
  readLaunchdLogTail: (...args: unknown[]) => readLaunchdLogTail(...args),
  readLaunchdLogSince: (...args: unknown[]) => readLaunchdLogSince(...args),
  revokeLaunchdLog: (...args: unknown[]) => revokeLaunchdLog(...args),
}));

const SERVICE = launchdService({
  configFiles: [
    configFile({
      details: {
        programArguments: ["/usr/bin/true"],
        argumentsTruncated: false,
        environmentKeys: [],
        standardOutPath: "~/Library/Logs/job.log",
      },
    }),
  ],
});

function snapshot(text: string, nextOffset: number): LogSnapshot {
  return {
    state: "CONTENT",
    text,
    skippedBytes: 0,
    headTrimmed: false,
    lossy: false,
    reset: null,
    nextOffset,
    fileSize: nextOffset,
    identity: { device: 1, inode: 2 },
  };
}

async function settle() {
  await act(async () => {});
}

async function tick(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}

/** Authorizes the file and reads the first tail, so the page is tracking. */
async function startTracking() {
  authorizeLaunchdLog.mockResolvedValue({ grantId: "g1", displayPath: "~/job.log" });
  readLaunchdLogTail.mockResolvedValue(snapshot("first\n", 6));
  revokeLaunchdLog.mockResolvedValue(undefined);
  const view = render(<ServiceLogs service={SERVICE} />);
  fireEvent.click(screen.getByRole("button", { name: "授权读取日志…" }));
  await settle();
  expect(screen.getByText("first")).toBeTruthy();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("service log polling", () => {
  it("appends each answer and then polls again", async () => {
    await startTracking();
    readLaunchdLogSince
      .mockResolvedValueOnce(snapshot("second\n", 13))
      .mockResolvedValueOnce(snapshot("third\n", 19));

    await tick(LOG_POLL_INTERVAL_MS);
    expect(screen.getByText("second")).toBeTruthy();
    await tick(LOG_POLL_INTERVAL_MS);
    expect(screen.getByText("third")).toBeTruthy();
    expect(readLaunchdLogSince).toHaveBeenCalledTimes(2);
  });

  it("drops a poll answer that arrives after tracking was stopped", async () => {
    await startTracking();
    const late = deferred<LogSnapshot>();
    readLaunchdLogSince.mockReturnValue(late.promise);
    await tick(LOG_POLL_INTERVAL_MS);
    expect(readLaunchdLogSince).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "停止追踪" }));
    late.resolve(snapshot("too late\n", 14));
    await settle();

    expect(screen.queryByText("too late")).toBeNull();
    expect(screen.queryByText("first")).toBeNull();
    await tick(LOG_POLL_INTERVAL_MS * 3);
    expect(readLaunchdLogSince).toHaveBeenCalledTimes(1);
  });

  it("neither sets state nor polls again after the panel unmounts", async () => {
    const { unmount } = await startTracking();
    const late = deferred<LogSnapshot>();
    readLaunchdLogSince.mockReturnValue(late.promise);
    await tick(LOG_POLL_INTERVAL_MS);
    expect(readLaunchdLogSince).toHaveBeenCalledTimes(1);

    unmount();
    late.resolve(snapshot("after unmount\n", 20));
    await settle();
    await tick(LOG_POLL_INTERVAL_MS * 3);

    expect(readLaunchdLogSince).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a busy answer", async () => {
    await startTracking();
    readLaunchdLogSince
      .mockRejectedValueOnce({ code: "CONFLICT", message: "busy", retryable: false })
      .mockResolvedValueOnce(snapshot("second\n", 13));

    await tick(LOG_POLL_INTERVAL_MS);
    // Still tracking: a busy answer is not a failure.
    expect(screen.getByRole("button", { name: "停止追踪" })).toBeTruthy();
    await tick(LOG_POLL_INTERVAL_MS);
    expect(screen.getByText("second")).toBeTruthy();
  });
});
