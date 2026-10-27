// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  GrantStoreNoticeView,
} from "../features/grants/GrantStoreNotice";
import type { GrantStoreNoticeState } from "../features/grants/grantStoreController";
import { DEFAULT_USER_PREFERENCES } from "../ipc/settings";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
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

function failedRefresh() {
  return render(
    <AppShell
      onAppearanceChange={() => Promise.resolve()}
      onRefresh={() => undefined}
      state={shellState({ refresh: { status: "error", message: REFRESH_FAILED } })}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("通知条版式（RF-4a）", () => {
  it("标题为加粗正文文字，不再渲染状态标签", () => {
    failedRefresh();

    const alert = screen.getByRole("alert");
    const heading = alert.querySelector("span.font-semibold");
    expect(heading?.textContent).toBe("刷新未完成");
    expect(heading?.className).toContain("text-body");
    expect(alert.querySelector('[class*="rounded-badge"]')).toBeNull();
  });

  it("关闭为仅图标按钮，按 aria-label 可查，消息正文不按状态染色", () => {
    failedRefresh();

    const alert = screen.getByRole("alert");
    const close = within(alert).getByRole("button", { name: "关闭" });
    expect(close.getAttribute("aria-label")).toBe("关闭");
    expect(close.textContent).toBe("");
    expect(close.className).toContain("r16-icon-button");

    const message = alert.querySelector("p");
    expect(message?.className).toContain("text-foreground");
    expect(message?.className).not.toMatch(/text-(danger|warning)/);
  });

  it("点击关闭后刷新失败提示消失", () => {
    failedRefresh();

    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("授权存储通知的标题沿用原标签文案，行内不含状态标签", () => {
    const state: GrantStoreNoticeState = {
      check: { phase: "unavailable", reason: "CORRUPT" },
      rechecking: false,
      dialog: { phase: "closed" },
    };
    const markup = renderToStaticMarkup(
      <GrantStoreNoticeView
        onCancel={() => undefined}
        onConfirm={() => undefined}
        onDismissCompleted={() => undefined}
        onRecheck={() => undefined}
        onRequestReset={() => undefined}
        state={state}
      />,
    );

    expect(markup).toContain(
      '<span class="shrink-0 text-body font-semibold text-foreground">授权存储不可用</span>',
    );
    expect(markup).not.toMatch(/rounded-badge/);
  });

  it("新增通知与工具栏样式不使用 !important 或 color-mix", () => {
    const shellNotice = css.slice(css.indexOf(".r12-shell-notice {"));
    const noticeRule = shellNotice.slice(0, shellNotice.indexOf("}") + 1);
    expect(noticeRule).not.toMatch(/!important|color-mix/);

    const toolbarRule = css.slice(
      css.indexOf(".desktop-workspace__toolbar {"),
      css.indexOf("}", css.indexOf(".desktop-workspace__toolbar {")) + 1,
    );
    expect(toolbarRule).not.toMatch(/color-mix/);
    expect(noticeRule).toContain("box-shadow: var(--app-shadow-float);");
  });
});
