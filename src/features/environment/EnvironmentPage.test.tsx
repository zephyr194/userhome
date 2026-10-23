// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { SectionContext } from "../../app/SectionContext";
import { EnvironmentPage } from "./EnvironmentPage";

function tabTags(markup: string): string[] {
  return markup.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
}

describe("environment page domains (markup)", () => {
  const markup = renderToStaticMarkup(<EnvironmentPage />);

  it("offers two domains as one vertical menu inside the page", () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="环境变量域"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(tabTags(markup)).toHaveLength(2);
    expect(markup).toContain("系统环境变量");
    expect(markup).toContain("zsh 与登录会话");
    expect(markup).toContain("目录 dotenv");
    expect(markup).toContain(".env 文件");
  });

  it("shows no system tabs while the dotenv domain is open", () => {
    expect(markup).not.toContain('aria-label="系统环境变量分区"');
  });

  it("opens on the dotenv domain and does not read zsh or login session data before they are opened", () => {
    const selected = tabTags(markup).find((tag) => tag.includes('aria-selected="true"'));
    expect(selected).toContain('data-section-id="dotenv"');
    expect(markup).not.toContain("正在读取 zsh 启动文件");
    expect(markup).not.toContain("正在读取登录会话的环境变量");
  });

  it("shows the two system tabs inside the system domain", () => {
    const system = renderToStaticMarkup(
      <SectionContext.Provider value={{ section: "zsh", select: () => undefined }}>
        <EnvironmentPage />
      </SectionContext.Provider>,
    );
    expect(system).toContain('aria-label="系统环境变量分区"');
    expect(tabTags(system)).toHaveLength(4);
    expect(system).toContain('data-section-id="zsh"');
    expect(system).toContain('data-section-id="launchctl"');
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

  it("reads each system tab only when it is first opened and keeps it mounted afterwards", async () => {
    render(<EnvironmentPage />);

    expect(screen.getByRole("tablist", { name: "环境变量域" }).getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /目录 dotenv/ }).getAttribute("aria-selected")).toBe("true");
    expect(calls).not.toContain("read_zsh_startup_files");
    expect(calls).not.toContain("read_launchctl_environment");

    fireEvent.click(screen.getByRole("tab", { name: /^系统环境变量/ }));
    await waitFor(() => expect(calls).toContain("read_zsh_startup_files"));
    expect(screen.getByRole("tab", { name: "zsh" }).getAttribute("aria-selected")).toBe("true");
    expect(calls).not.toContain("read_launchctl_environment");

    fireEvent.click(screen.getByRole("tab", { name: "登录会话" }));
    await waitFor(() => expect(calls).toContain("read_launchctl_environment"));
    expect(screen.getByRole("heading", { name: "macOS 登录会话" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "zsh" }));
    fireEvent.click(screen.getByRole("tab", { name: /目录 dotenv/ }));
    fireEvent.click(screen.getByRole("tab", { name: /^系统环境变量/ }));

    expect(screen.getByRole("tab", { name: "zsh" }).getAttribute("aria-selected")).toBe("true");

    expect(calls.filter((command) => command === "read_launchctl_environment")).toHaveLength(1);
  });
});

describe("environment page sections with the shell", () => {
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("opens the login session tab for the launchctl section and reads only that domain", async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      return Promise.reject({ code: "INTERNAL", message: "测试环境不可用", retryable: false });
    });

    render(
      <SectionContext.Provider value={{ section: "launchctl", select: () => undefined }}>
        <EnvironmentPage />
      </SectionContext.Provider>,
    );

    expect(screen.getByRole("tab", { name: "登录会话" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(calls).toContain("read_launchctl_environment"));
    expect(calls).not.toContain("read_zsh_startup_files");
  });

  it("reports the section of each tab and domain to the shell", () => {
    mockIPC(() => Promise.reject({ code: "INTERNAL", message: "测试环境不可用", retryable: false }));
    const select = vi.fn();
    render(
      <SectionContext.Provider value={{ section: "zsh", select }}>
        <EnvironmentPage />
      </SectionContext.Provider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "登录会话" }));
    expect(select).toHaveBeenLastCalledWith("launchctl");

    fireEvent.click(screen.getByRole("tab", { name: /目录 dotenv/ }));
    expect(select).toHaveBeenLastCalledWith("dotenv");
  });
});
