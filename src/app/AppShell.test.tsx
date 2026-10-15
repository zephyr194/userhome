import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell, QuitConfirmationDialog, type QuitPrompt } from "./AppShell";
import { applyAppearance } from "./appearance";
import { AppearanceSettings } from "../features/settings/AppearanceSettings";
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
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(
      '<header class="titlebar" data-tauri-drag-region="true">',
    );
    expect(markup).toContain(
      '<p class="titlebar__title" data-tauri-drag-region="true">',
    );
    expect(markup).not.toMatch(/<(?:button|a|input)[^>]*data-tauri-drag-region/);
  });

  it("groups primary navigation and leaves out the retired application and Homebrew entries", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={loadingState}
      />,
    );

    const nav = markup.match(/<nav aria-label="主导航"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeDefined();
    for (const label of ["系统工具", "工具集", "支撑"]) {
      expect(nav).toContain(`>${label}</p>`);
    }
    expect(nav).not.toContain("系统控制台");
    expect(nav).toContain('href="#dashboard"');
    expect(nav).toContain('href="#services"');
    expect(nav).toContain('href="#settings"');
    expect(nav).not.toContain('href="#applications"');
    expect(nav).not.toContain('href="#homebrew"');
    expect(nav).not.toContain('title="应用与配置"');
    expect(nav).not.toContain('title="软件"');
    expect(nav?.match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav).toContain('aria-controls="main-content"');
  });

  it("keeps a single brand identity inside the navigation rail", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={loadingState}
      />,
    );

    // The Control Lab sub-brand must exist once, in the navigation rail only.
    expect(markup.match(/CONTROL LAB/g)).toHaveLength(1);
    const railBrand = markup.match(
      /<div class="navigation-rail__brand">[\s\S]*?<\/div>/,
    )?.[0];
    expect(railBrand).toContain("CONTROL LAB");
    // The titlebar never repeats the sub-brand.
    const titlebar = markup.match(/<header class="titlebar"[\s\S]*?<\/header>/)?.[0];
    expect(titlebar).toBeDefined();
    expect(titlebar).not.toContain("Control Lab");
    expect(titlebar).not.toContain("CONTROL LAB");
  });

  it("exposes one context toolbar, one page title, and one refresh action", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={loadingState}
      />,
    );

    expect(markup.match(/aria-label="当前页面工具栏"/g)).toHaveLength(1);
    expect(markup).toContain(
      '<h1 class="desktop-workspace__page-title">概览</h1>',
    );
    expect(markup.match(/toolbar-refresh-button/g)).toHaveLength(1);
    // No leftover shell hero or duplicate brand panel.
    expect(markup).not.toContain("interface-preview");
    expect(markup).not.toContain("welcome-panel");
  });

  it("maps each persisted appearance value to its attribute and color scheme", () => {
    const documentElement = {
      dataset: {} as Record<string, string>,
      style: { colorScheme: "" },
    };
    vi.stubGlobal("document", { documentElement });

    const cases = [
      ["SYSTEM", "system", "light dark"],
      ["LIGHT", "light", "light"],
      ["DARK", "dark", "dark"],
    ] as const;

    for (const [appearance, attribute, colorScheme] of cases) {
      applyAppearance(appearance);
      expect(documentElement.dataset.appearance).toBe(attribute);
      expect(documentElement.style.colorScheme).toBe(colorScheme);
    }
  });

  it("renders the three persisted appearance choices", () => {
    const markup = renderToStaticMarkup(
      <AppearanceSettings
        appearance="LIGHT"
        onChange={() => Promise.resolve()}
      />,
    );

    expect(markup.match(/role="radio"/g) ?? []).toHaveLength(3);
    expect(markup.match(/aria-checked="true"/g) ?? []).toHaveLength(1);
    expect(markup).toContain('name="appearance"');
    expect(markup).toContain('value="LIGHT"');
    expect(markup).toContain("系统");
    expect(markup).toContain("浅色");
    expect(markup).toContain("深色");
  });

  it("keeps primary navigation focus while allowing source-sensitive main focus", () => {
    const source = AppShell.toString();
    expect(source).toContain("primary-nav");
    expect(source).toContain("main-content");
    expect(source).toContain("preventScroll");
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

  it("renders a persistent refresh-failure alert with a unified retry action", () => {
    const state: ShellState = {
      ...loadingState,
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
    expect(markup).toContain("刷新未完成");
    expect(markup).toContain("刷新完成，但部分信息不可用。");
    const alertRegion = markup.match(
      /<div[^>]*role="alert"[\s\S]*?<\/div>/,
    )?.[0];
    expect(alertRegion).toContain("重试");
    expect(alertRegion).toContain(">重试</button>");
  });

  it("states plainly that previous data is retained when a snapshot survives a failed refresh", () => {
    const state: ShellState = {
      ...loadingState,
      discovery: {
        status: "error",
        error: {
          code: "INTERNAL",
          message: "刷新失败。",
          retryable: true,
        },
        previousSnapshot: {
          refreshId: "refresh-1",
          startedAtEpochMs: 1,
          system: { status: "LOADING" },
          brew: { status: "LOADING" },
          candidates: { status: "LOADING" },
        },
      },
      refresh: { status: "error", message: "刷新失败。" },
    };

    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={state}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("已保留上次成功加载的数据。");
  });

  it("announces a completed refresh as a quiet status rather than an alert", () => {
    const state: ShellState = {
      ...loadingState,
      refresh: {
        status: "ready",
        completedAt: "2026-09-20T09:30:00Z",
      },
    };

    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={state}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("本机状态已刷新。");
    expect(markup).not.toContain('role="alert"');
  });

  it("falls back to the dashboard when a retired Homebrew route was persisted", () => {
    const state: ShellState = {
      applications: { status: "loading" },
      connection: { status: "loading" },
      discovery: {
        status: "error",
        error: {
          code: "INTERNAL",
          message: "刷新失败。",
          retryable: true,
        },
        previousSnapshot: {
          refreshId: "refresh-1",
          startedAtEpochMs: 1,
          system: { status: "LOADING" },
          brew: {
            status: "READY",
            data: {
              available: true,
              version: "4.0.0",
              prefix: "/opt/homebrew",
              formulaCount: 12,
              caskCount: 4,
            },
          },
          candidates: { status: "LOADING" },
        },
      },
      preferences: {
        status: "ready",
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
      },
      recentOperation: { status: "empty" },
      refresh: { status: "error", message: "刷新失败。" },
    };
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({ routeId: "homebrew", settingsGroup: "appearance" }),
      removeItem: () => undefined,
    });

    const markup = renderToStaticMarkup(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={state}
      />,
    );

    // The retired Homebrew route is no longer restorable: the persisted id
    // falls back to the dashboard.
    expect(markup).toContain("概览");
    expect(markup).not.toContain("Formula 12");
    expect(markup).not.toContain("正在显示上次成功刷新保留的 Homebrew 数据。");
  });
});

describe("QuitConfirmationDialog", () => {
  const render = (prompt: QuitPrompt) =>
    renderToStaticMarkup(
      <QuitConfirmationDialog
        onCancel={() => undefined}
        onConfirm={() => undefined}
        prompt={prompt}
      />,
    );

  it("asks to stop and quit or cancel, with cancel as the focus default", () => {
    const markup = render({ phase: "asking", processCount: 2 });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="quit-confirmation-heading"');
    expect(markup).toContain('id="quit-confirmation-heading"');
    expect(markup).toContain("退出 UserHome？");
    expect(markup).toContain("2");
    expect(markup).toContain("data-dialog-cancel");
    expect(markup).toContain(">取消退出<");
    expect(markup).toContain(">停止并退出<");
    expect(markup).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(markup).not.toContain('role="alert"');
  });

  it("disables both choices and announces progress while stopping", () => {
    const markup = render({ phase: "stopping", processCount: 1 });

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("正在停止进程并等待其退出");
    expect(markup.match(/<button[^>]*\sdisabled=""/g)).toHaveLength(2);
  });

  it("reports an unconfirmed exit honestly and offers retry or cancel", () => {
    const markup = render({
      phase: "failed",
      processCount: 1,
      message: "应用未退出：无法确认以下进程已退出：caddy。它们可能仍在运行。",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("应用未退出");
    expect(markup).toContain("caddy");
    expect(markup).toContain(">重试停止并退出<");
    expect(markup).toContain(">取消退出<");
  });
});
