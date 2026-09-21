import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const loadingState: ShellState = {
  applications: { status: "loading" },
  connection: { status: "loading" },
  discovery: { status: "loading" },
  preferences: { status: "loading" },
  recentOperation: { status: "empty" },
  refresh: { status: "refreshing" },
};

describe("AppShell", () => {
  it("renders the accessible desktop shell and primary navigation", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={loadingState}
      />,
    );

    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain('<nav aria-label="主导航"');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("概览");
    expect(markup).toContain("应用");
    expect(markup).toContain("Homebrew");
    expect(markup).toContain("服务");
    expect(markup).toContain("设置");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
  });

  it("does not programmatically move navigation focus into the main pane", () => {
    expect(AppShell.toString()).not.toContain(".focus(");
  });

  it("keeps connection failures separate from an empty operation history", () => {
    const state: ShellState = {
      applications: { status: "loading" },
      connection: {
        status: "error",
        error: {
          code: "INTERNAL",
          message: "无法连接本地服务。",
          retryable: true,
        },
      },
      discovery: { status: "loading" },
      preferences: {
        status: "safe-default",
        preferences: {
          schemaVersion: 1,
          appearance: "SYSTEM",
          openWindowOnLaunch: true,
          closeBehavior: "KEEP_RUNNING_IN_TRAY",
          restoreSelection: true,
          refreshOnLaunch: true,
          refreshOnReopen: true,
          providerTimeoutPreset: "STANDARD",
          preferredEditorMode: "STRUCTURED",
          backupRetention: 20,
          optionalDiscoveryRoots: [],
        },
        diagnostic: {
          code: "INVALID_DOCUMENT",
          message: "偏好设置无效，已启用安全默认值。",
        },
      },
      recentOperation: { status: "empty" },
      refresh: {
        status: "error",
        message: "刷新完成，但部分信息不可用。",
      },
    };

    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={state}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("无法连接本地服务。");
    expect(markup).toContain("暂无操作记录。");
    expect(markup).toContain("刷新完成，但部分信息不可用。");
    expect(markup).toContain("安全默认值");
    expect(markup).toContain("偏好设置无效，已启用安全默认值。");
  });
});
