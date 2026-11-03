// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaddyLogPage, CaddyRunStatus, CaddyStatus } from "../../ipc/caddy";
import { deferred } from "../../test/deferred";
import { renderStrict } from "../../test/renderStrict";
import { CaddyRunPanel } from "./CaddyRunPanel";

const caddyStatus = vi.fn();
const caddyStop = vi.fn();
const caddyLogs = vi.fn();

vi.mock("../../ipc/caddy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/caddy")>()),
  caddyStatus: (...args: unknown[]) => caddyStatus(...args),
  caddyStop: (...args: unknown[]) => caddyStop(...args),
  caddyLogs: (...args: unknown[]) => caddyLogs(...args),
}));

const POLL_MS = 1000;

function running(sessionId: string): CaddyStatus {
  return {
    state: "RUNNING",
    message: "运行中：进程存活且管理端点已就绪。",
    diagnostics: [],
    sessionId,
    source: "RULES",
    applied: "APPLIED",
    applying: false,
  };
}

const STOPPED: CaddyRunStatus = {
  state: "STOPPED",
  message: "未运行。",
  diagnostics: [],
};

function page(sessionId: string, text: string, offset: number, hasMore = false): CaddyLogPage {
  return {
    sessionId,
    stdout: text,
    stderr: "",
    stdoutOffset: offset,
    stderrOffset: 0,
    hasMore,
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

beforeEach(() => {
  vi.useFakeTimers();
  caddyLogs.mockResolvedValue(page("s-1", "", 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Caddy status polling", () => {
  it("keeps one polling chain after StrictMode's double mount", async () => {
    caddyStatus.mockResolvedValue(running("s-1"));

    renderStrict(<CaddyRunPanel source="RULES" />);
    await settle();
    expect(caddyStatus).toHaveBeenCalledTimes(2);

    await tick(POLL_MS);
    expect(caddyStatus).toHaveBeenCalledTimes(3);
    await tick(POLL_MS);
    expect(caddyStatus).toHaveBeenCalledTimes(4);
  });

  it("drops a poll answer that arrives after a newer stop answer", async () => {
    caddyStatus.mockResolvedValueOnce(running("s-1"));
    renderStrict(<CaddyRunPanel source="RULES" />);
    await settle();
    expect(screen.getByText("● 运行中")).toBeTruthy();

    const latePoll = deferred<CaddyStatus>();
    caddyStatus.mockReturnValue(latePoll.promise);
    await tick(POLL_MS);
    expect(caddyStatus).toHaveBeenCalledTimes(3);

    caddyStop.mockResolvedValue(STOPPED);
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await settle();
    expect(screen.getByText("○ 已停止")).toBeTruthy();

    latePoll.resolve(running("s-1"));
    await settle();

    expect(screen.getByText("○ 已停止")).toBeTruthy();
    expect(screen.queryByText("● 运行中")).toBeNull();
  });

  it("neither sets state nor polls again after the panel unmounts", async () => {
    const late = deferred<CaddyStatus>();
    caddyStatus.mockReturnValue(late.promise);

    const { unmount } = renderStrict(<CaddyRunPanel source="RULES" />);
    await settle();
    const calls = caddyStatus.mock.calls.length;

    unmount();
    late.resolve(running("s-1"));
    await settle();
    await tick(POLL_MS * 3);

    expect(caddyStatus).toHaveBeenCalledTimes(calls);
  });
});

describe("Caddy log polling", () => {
  it("drops a log page of the previous session after the session changed", async () => {
    const lateOld = deferred<CaddyLogPage>();
    caddyStatus
      .mockResolvedValueOnce(running("s-1"))
      .mockResolvedValue(running("s-2"));
    caddyLogs.mockImplementation((sessionId: string) =>
      sessionId === "s-1" ? lateOld.promise : Promise.resolve(page("s-2", "new session line\n", 18)),
    );

    render(<CaddyRunPanel source="RULES" />);
    await settle();
    expect(caddyLogs).toHaveBeenCalledWith("s-1", 0, 0);

    await tick(POLL_MS);
    expect(caddyLogs).toHaveBeenCalledWith("s-2", 0, 0);
    expect(screen.getByText(/new session line/)).toBeTruthy();

    lateOld.resolve(page("s-1", "old session line\n", 17));
    await settle();

    expect(screen.queryByText(/old session line/)).toBeNull();
    expect(screen.getByText(/new session line/)).toBeTruthy();
  });

  it("appends each page and then polls again from the new offset", async () => {
    caddyStatus.mockResolvedValue(running("s-1"));
    caddyLogs
      .mockResolvedValueOnce(page("s-1", "first\n", 6))
      .mockResolvedValueOnce(page("s-1", "second\n", 13));

    renderStrict(<CaddyRunPanel source="RULES" />);
    await settle();
    expect(screen.getByText(/first/)).toBeTruthy();

    await tick(POLL_MS);
    expect(screen.getByText(/second/)).toBeTruthy();
    expect(caddyLogs).toHaveBeenLastCalledWith("s-1", 6, 0);
  });

  it("neither sets state nor polls again after the panel unmounts", async () => {
    const late = deferred<CaddyLogPage>();
    caddyStatus.mockResolvedValue(running("s-1"));
    caddyLogs.mockReturnValue(late.promise);

    const { unmount } = renderStrict(<CaddyRunPanel source="RULES" />);
    await settle();
    const calls = caddyLogs.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    unmount();
    late.resolve(page("s-1", "after unmount\n", 14));
    await settle();
    await tick(POLL_MS * 3);

    expect(caddyLogs).toHaveBeenCalledTimes(calls);
  });
});
