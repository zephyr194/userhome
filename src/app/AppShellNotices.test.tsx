// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_USER_PREFERENCES } from "../ipc/settings";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const SAFE_DEFAULT = "偏好设置文件无法读取，已临时使用默认值。";
const REFRESH_FAILED = "刷新失败。";

function shellState(overrides: Partial<ShellState>): ShellState {
  return {
    connection: { status: "loading" },
    discovery: { status: "loading" },
    preferences: { status: "ready", preferences: DEFAULT_USER_PREFERENCES },
    recentOperation: { status: "empty" },
    refresh: { status: "idle" },
    ...overrides,
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

const SAFE_DEFAULT_STATE = shellState({
  preferences: {
    status: "safe-default",
    preferences: DEFAULT_USER_PREFERENCES,
    diagnostic: { code: "READ_FAILED", message: SAFE_DEFAULT },
  },
});

afterEach(() => {
  cleanup();
});

describe("workspace notices", () => {
  it("stacks several alerts inside the notice overlay", () => {
    render(
      <Shell
        state={shellState({
          preferences: SAFE_DEFAULT_STATE.preferences,
          refresh: { status: "error", message: REFRESH_FAILED },
        })}
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert.closest('[data-overlay="notices"]')).not.toBeNull();
    }
  });

  it("removes a safe-default alert when its close button is pressed", () => {
    render(<Shell state={SAFE_DEFAULT_STATE} />);

    expect(screen.queryByText(SAFE_DEFAULT)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(SAFE_DEFAULT)).toBeNull();
  });

  it("keeps a refresh failure visible until a later refresh clears it", () => {
    const { rerender } = render(
      <Shell state={shellState({ refresh: { status: "error", message: REFRESH_FAILED } })} />,
    );
    expect(screen.queryByText(REFRESH_FAILED)).not.toBeNull();

    rerender(<Shell state={shellState({ refresh: { status: "idle" } })} />);
    expect(screen.queryByText(REFRESH_FAILED)).toBeNull();
  });

  it("lets the user close a refresh failure and shows it again after the next refresh request", () => {
    const failed = shellState({ refresh: { status: "error", message: REFRESH_FAILED } });
    const { rerender } = render(<Shell state={failed} />);
    expect(screen.getAllByText(REFRESH_FAILED).length).toBeGreaterThan(0);

    const alert = screen.getByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    rerender(<Shell state={shellState({ refresh: { status: "refreshing" } })} />);
    rerender(<Shell state={failed} />);
    expect(screen.getByRole("alert")).not.toBeNull();
  });
});
