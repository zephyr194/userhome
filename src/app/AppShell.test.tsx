import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const loadingState: ShellState = {
  applications: { status: "loading" },
  connection: { status: "loading" },
  discovery: { status: "loading" },
  recentOperation: { status: "empty" },
  refresh: { status: "refreshing" },
};

describe("AppShell", () => {
  it("renders the accessible desktop shell and primary navigation", () => {
    const markup = renderToStaticMarkup(
      <AppShell onRefresh={() => undefined} state={loadingState} />,
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
      recentOperation: { status: "empty" },
      refresh: {
        status: "error",
        message: "刷新完成，但部分信息不可用。",
      },
    };

    const markup = renderToStaticMarkup(
      <AppShell onRefresh={() => undefined} state={state} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("无法连接本地服务。");
    expect(markup).toContain("暂无操作记录。");
    expect(markup).toContain("刷新完成，但部分信息不可用。");
  });
});
