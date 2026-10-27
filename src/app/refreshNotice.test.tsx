// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const SUCCESS_NOTICE = "本机状态已刷新。";
const FAILURE_LABEL = "刷新未完成";

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

describe("刷新成功不再弹出提示", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows no success notice after a refresh completes", () => {
    render(
      <Shell
        state={shellState({ status: "ready", completedAt: "2026-10-22T01:00:00Z" })}
      />,
    );

    expect(screen.queryByText(SUCCESS_NOTICE)).toBeNull();
    expect(screen.queryByText(FAILURE_LABEL)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a failed refresh visible as an alert", () => {
    render(
      <Shell state={shellState({ status: "error", message: "刷新失败。" })} />,
    );

    expect(screen.getByRole("alert").textContent).toContain(FAILURE_LABEL);
    expect(screen.queryByText(SUCCESS_NOTICE)).toBeNull();
  });
});
