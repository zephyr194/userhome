// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { EnvironmentPage } from "./EnvironmentPage";

function tabTags(markup: string): string[] {
  return markup.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
}

describe("environment page domains (markup)", () => {
  const markup = renderToStaticMarkup(<EnvironmentPage />);

  it("offers the three domains as one vertical menu inside the page", () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="环境变量域"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(tabTags(markup)).toHaveLength(3);
    expect(markup).toContain("项目 dotenv");
    expect(markup).toContain("用户 zsh");
    expect(markup).toContain("登录会话");
    expect(markup).toContain(".env 文件");
    expect(markup).toContain("GUI 应用看到的变量");
  });

  it("no longer renders the old horizontal section tabs", () => {
    expect(markup).not.toContain('aria-label="环境配置分区"');
  });

  it("opens on the dotenv domain and does not read zsh or login session data before they are opened", () => {
    const selected = tabTags(markup).find((tag) => tag.includes('aria-selected="true"'));
    expect(selected).toContain('data-section-id="dotenv"');
    expect(markup).not.toContain("正在读取 zsh 启动文件");
    expect(markup).not.toContain("正在读取登录会话的环境变量");
  });
});

describe("environment page domain switching", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    mockIPC((command) => {
      calls.push(command);
      return Promise.reject({ code: "INTERNAL", message: "测试环境不可用", retryable: false });
    });
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("reads each domain only when it is first opened and keeps it mounted afterwards", async () => {
    render(<EnvironmentPage />);

    expect(screen.getByRole("tablist", { name: "环境变量域" }).getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /项目 dotenv/ }).getAttribute("aria-selected")).toBe("true");
    expect(calls).not.toContain("read_zsh_startup_files");
    expect(calls).not.toContain("read_launchctl_environment");

    fireEvent.click(screen.getByRole("tab", { name: /用户 zsh/ }));
    await waitFor(() => expect(calls).toContain("read_zsh_startup_files"));
    expect(calls).not.toContain("read_launchctl_environment");

    fireEvent.click(screen.getByRole("tab", { name: /登录会话/ }));
    await waitFor(() => expect(calls).toContain("read_launchctl_environment"));
    expect(screen.getByRole("heading", { name: "macOS 登录会话" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /用户 zsh/ }));
    fireEvent.click(screen.getByRole("tab", { name: /项目 dotenv/ }));
    fireEvent.click(screen.getByRole("tab", { name: /登录会话/ }));

    expect(calls.filter((command) => command === "read_zsh_startup_files")).toHaveLength(1);
    expect(calls.filter((command) => command === "read_launchctl_environment")).toHaveLength(1);
  });
});
