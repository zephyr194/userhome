// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LaunchctlEnvironment } from "../../ipc/environment";
import { LaunchctlView, type LaunchctlState } from "./LaunchctlView";

const READ_AT = "2026-10-22T09:30:00+08:00";

const ENVIRONMENT: LaunchctlEnvironment = {
  entries: [
    { key: "PATH", value: "/usr/bin:/bin", secret: false },
    { key: "EMPTY_ONE", value: "", secret: false },
    { key: "API_TOKEN", value: null, secret: true },
  ],
  readAt: READ_AT,
  partial: false,
};

function renderView(state: LaunchctlState, options: {
  onReveal?: (key: string) => Promise<string>;
  onRetry?: () => void;
} = {}) {
  const onReveal = options.onReveal ?? vi.fn(async () => "s3cret");
  const onRetry = options.onRetry ?? vi.fn();
  render(<LaunchctlView onReveal={onReveal} onRetry={onRetry} state={state} />);
  return { onReveal, onRetry };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LaunchctlView", () => {
  it("names the domain, explains it, and shows when the list was read", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    expect(screen.getByRole("heading", { name: "macOS 登录会话（只读）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：登录会话变量" })).toBeTruthy();
    expect(screen.getByText(`读取时间：${new Date(READ_AT).toLocaleString("zh-CN")}`)).toBeTruthy();
  });

  it("shows a placeholder while the list is loading and disables re-reading", () => {
    renderView({ status: "loading" });

    expect(screen.getByRole("status").textContent).toContain("正在读取登录会话的环境变量");
    expect(screen.getByRole("button", { name: "重新读取" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains an empty session and what does not show up", () => {
    renderView({
      status: "ready",
      environment: { entries: [], readAt: READ_AT, partial: false },
    });

    expect(screen.getByText("登录会话里没有可见的环境变量。")).toBeTruthy();
    expect(screen.getByText(/终端里设置的变量不会出现/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the reason for a failed read and retries from the error block", () => {
    const { onRetry } = renderView({ status: "failed", message: "权限不足" });

    expect(screen.getByRole("alert").textContent).toContain("原因：权限不足");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("re-reads from the header button", () => {
    const { onRetry } = renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows plain values as text and marks an empty value", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    expect(screen.getByRole("rowheader", { name: "PATH" })).toBeTruthy();
    expect(screen.getByText("/usr/bin:/bin")).toBeTruthy();
    expect(screen.getByText("（空值）")).toBeTruthy();
  });

  it("keeps a secret masked until its value is loaded and shown on request", async () => {
    const { onReveal } = renderView({ status: "ready", environment: ENVIRONMENT });

    const row = screen.getByRole("rowheader", { name: "API_TOKEN" }).closest("tr");
    expect(row?.textContent).toContain("已隐藏，值尚未载入");
    expect(screen.queryByText("s3cret")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledWith("API_TOKEN"));
    fireEvent.click(await screen.findByRole("button", { name: "显示 API_TOKEN 的值" }));

    expect(await screen.findByText("s3cret")).toBeTruthy();
  });

  it("shows the reason when a secret value cannot be loaded", async () => {
    renderView(
      { status: "ready", environment: ENVIRONMENT },
      { onReveal: () => Promise.reject({ code: "INTERNAL", message: "读取失败", retryable: false }) },
    );

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));

    expect((await screen.findByRole("status")).textContent).toContain("载入失败：读取失败");
    expect(screen.queryByText("s3cret")).toBeNull();
  });

  it("warns that the list may be incomplete after a partial read", () => {
    renderView({ status: "ready", environment: { ...ENVIRONMENT, partial: true } });

    expect(screen.getByText(/下面的列表可能不完整/)).toBeTruthy();
  });
});
