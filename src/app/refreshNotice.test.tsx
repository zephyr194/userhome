// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const NOTICE = "本机状态已刷新。";

function shellState(refresh: ShellState["refresh"]): ShellState {
  return {
    connection: { status: "loading" },
    discovery: { status: "loading" },
    preferences: { status: "loading" },
    recentOperation: { status: "empty" },
    refresh,
  };
}

function Shell({ state }: { state: ShellState }) {
  return (
    <AppShell
      onAppearanceChange={() => Promise.resolve()}
      onRefresh={() => undefined}
      state={state}
    />
  );
}

describe("刷新完成提示只短暂出现", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("disappears three seconds after a refresh completes", () => {
    render(
      <Shell
        state={shellState({ status: "ready", completedAt: "2026-10-22T01:00:00Z" })}
      />,
    );
    expect(screen.queryByText(NOTICE)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.queryByText(NOTICE)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("appears again when a later refresh completes", () => {
    const { rerender } = render(
      <Shell
        state={shellState({ status: "ready", completedAt: "2026-10-22T01:00:00Z" })}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(NOTICE)).toBeNull();

    rerender(<Shell state={shellState({ status: "refreshing" })} />);
    rerender(
      <Shell
        state={shellState({ status: "ready", completedAt: "2026-10-22T01:05:00Z" })}
      />,
    );
    expect(screen.queryByText(NOTICE)).not.toBeNull();
  });
});
