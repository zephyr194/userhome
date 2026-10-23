/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigationRail } from "../components/NavigationRail";
import { APP_ROUTES } from "./routeDefinitions";
import type { ConnectionState } from "./shellState";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8");

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function resolve(value: string): string {
  const token = value.match(/^var\(--([\w-]+)\)$/);
  return token ? tokenValue(token[1]) : value.trim();
}

function rulesFor(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").map((part) => part.trim()).includes(selector),
    )
    .map((match) => match[2]);
}

function declared(selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return rulesFor(selector).flatMap((body) =>
    [...body.matchAll(pattern)].map((match) => match[1].trim()),
  );
}

function lastDeclared(selector: string, property: string): string {
  const values = declared(selector, property);
  expect(values, `${selector} ${property}`).not.toHaveLength(0);
  return values[values.length - 1];
}

function toMs(value: string): number {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  if (!match) throw new Error(`unparsed duration ${value}`);
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

function renderRail(connection?: ConnectionState, activeRouteId = APP_ROUTES[0].id) {
  return renderToStaticMarkup(
    <NavigationRail
      activeRouteId={activeRouteId}
      connection={connection}
      onNavigate={() => undefined}
      routes={APP_ROUTES}
    />,
  );
}

describe("导航当前页", () => {
  it("当前导航项带 aria-current=page，且仅有一个", () => {
    const markup = renderRail();
    const current = markup.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="#${APP_ROUTES[0].id}"`);
  });

  it("当前态由 .slide-list 滑动指示器承担：浅橙底、3px 色条与 2px 宽的旧色条都不再由 a[aria-current] 单独绘制", () => {
    expect(rulesFor('.navigation-rail a[aria-current="page"]')).toEqual([]);
    expect(rulesFor('.navigation-rail a[aria-current="page"]::before')).toEqual([]);
    expect(lastDeclared(".slide-list[data-slide-ready]::before", "background")).toBe(
      "var(--app-selection)",
    );
    expect(lastDeclared(".slide-list[data-slide-ready]::before", "box-shadow")).toBe(
      "inset 0 0 0 1px var(--app-selection-border)",
    );
    expect(css).toMatch(
      /\.slide-list:not\(\[data-slide-ready\]\) \.slide-item:is\([^{]*\)\s*\{[^}]*background:\s*var\(--app-selection\)/,
    );
    expect(rulesFor(".navigation-rail a::before")).toEqual([]);
  });
});

describe("导航项尺寸与交互", () => {
  it("导航项高度使用 compact 行高令牌（28px），不被内边距撑高", () => {
    expect(resolve(lastDeclared(".navigation-rail a", "height"))).toBe("28px");
    expect(lastDeclared(".navigation-rail a", "height")).toBe(
      "var(--app-row-height-compact)",
    );
    expect(tokenValue("app-row-height-compact")).toBe("28px");
    expect(lastDeclared(".navigation-rail a", "padding")).toMatch(/^0\s/);
  });

  it("悬停态使用侧栏悬停令牌背景（与侧栏底色对比高于 surface-muted）", () => {
    expect(lastDeclared(".navigation-rail a:hover", "background")).toBe(
      "var(--app-sidebar-hover)",
    );
  });

  it("侧栏链接不画焦点环（用户 2026-10-22 决定去掉所有焦点外框）", () => {
    expect(css).not.toMatch(/\.navigation-rail a:focus-visible\s*\{/);
  });

  it("侧栏宽度为 188px，并与内容区之间保留 1px 分隔线", () => {
    expect(tokenValue("app-sidebar-width")).toBe("188px");
    expect(lastDeclared(".desktop-workspace__sidebar", "border-right")).toContain(
      "var(--app-line-subtle)",
    );
  });

  it("导航项与状态过渡时长不超过 120ms 且为线性缓动", () => {
    const selectors = [".navigation-rail a", ".navigation-rail__status > span"];
    for (const selector of selectors) {
      const duration = lastDeclared(selector, "transition-duration");
      expect(toMs(resolve(duration)), selector).toBeLessThanOrEqual(120);
      expect(lastDeclared(selector, "transition-timing-function"), selector).toBe(
        "linear",
      );
    }
  });
});

describe("侧栏分组标题", () => {
  it("侧栏保留三组分组标题，样式只由 r6-nav 区块承担", () => {
    const markup = renderRail();
    expect(markup.match(/navigation-rail__section-label/g)).toHaveLength(3);
    expect(rulesFor(".navigation-rail__section-label")).not.toHaveLength(0);
  });
});


describe("状态指示不只靠颜色", () => {
  it("在线、连接中、异常三种状态各有形状符号", () => {
    expect(lastDeclared(".navigation-rail__status--ready > span", "background")).toBe(
      "currentColor",
    );
    expect(lastDeclared(".navigation-rail__status--loading > span", "border-style")).toBe(
      "dashed",
    );
    const error = rulesFor(".navigation-rail__status--error > span").join("\n");
    expect(error).toMatch(/border-radius:\s*0/);
    expect(error).toMatch(/background:\s*currentColor/);
  });

  it("状态文字随状态渲染，不依赖颜色区分", () => {
    expect(renderRail({ status: "loading" })).toContain(
      "navigation-rail__status--loading",
    );
    expect(renderRail({ status: "loading" })).toContain("正在连接");
    const error = renderRail({
      status: "error",
      error: { code: "INTERNAL", message: "无法连接本地服务。", retryable: true },
    });
    expect(error).toContain("navigation-rail__status--error");
    expect(error).toContain("连接异常");
  });
});

describe("标题栏与工具栏", () => {
  it("标题栏高度为 44px 令牌，底部以 line 令牌画 1px 线，无阴影", () => {
    expect(tokenValue("app-titlebar-height")).toBe("44px");
    expect(lastDeclared(".titlebar", "border-bottom")).toBe(
      "1px solid var(--app-line-subtle)",
    );
    expect(rulesFor(".titlebar").join("\n")).not.toMatch(/box-shadow/);
  });

  it("工具栏最小高度为 60px 令牌，顶部 12px 留白、底部不留白（标题贴顶、说明紧贴标题）", () => {
    expect(lastDeclared(".desktop-workspace__toolbar", "min-height")).toBe(
      "var(--app-toolbar-height-roomy)",
    );
    expect(tokenValue("app-toolbar-height")).toBe("44px");
    expect(lastDeclared(".desktop-workspace__toolbar", "padding")).toBe(
      "var(--app-space-12) var(--app-space-16) 0",
    );
    expect(lastDeclared(".desktop-workspace__toolbar p", "line-height")).toBe(
      "var(--app-line-height-meta)",
    );
  });

  it("标题栏保留拖拽区与红绿灯避让的左右留白", () => {
    expect(lastDeclared(".titlebar", "padding")).toBe("0 78px");
    expect(lastDeclared(".titlebar", "-webkit-app-region")).toBe("drag");
  });
});

describe("全局约束", () => {
  it("global.css 与外壳源码不使用 clip-path", () => {
    expect(css).not.toContain("clip-path");
    for (const file of ["app/AppShell.tsx", "components/NavigationRail.tsx"]) {
      const source = readFileSync(join(srcRoot, file), "utf8");
      expect(source, file).not.toContain("clip-path");
    }
  });

  it("导航与外壳样式不新增渐变或发光", () => {
    const shellRules = [
      ".navigation-rail a",
      ".navigation-rail__status > span",
      ".titlebar",
      ".desktop-workspace__toolbar",
    ].flatMap((selector) => rulesFor(selector));
    const body = shellRules.join("\n");
    expect(body).not.toMatch(/gradient|drop-shadow|text-shadow/);
  });
});

describe("外壳焦点与刷新提示（r4-fe5）", () => {
  it("全局焦点重置也覆盖程序聚焦的 tabindex=-1 容器（主内容区、结果标题）", () => {
    expect(css).not.toContain('[tabindex]:not([tabindex="-1"])');
    expect(css).toMatch(/:where\([^{]*\[tabindex\][^{]*\):focus\s*\{\s*outline:\s*none;/);
  });

  it("刷新提示 3 秒内淡出，reduced-motion 下不做动画", () => {
    const block = css.slice(
      css.indexOf("/* r4-fe5-shell */"),
      css.indexOf("/* /r4-fe5-shell */"),
    );
    expect([...block.matchAll(/animation:\s*([^;]+);/g)].map((match) => match[1].trim())).toEqual([
      "r4-fe5-refreshed-out 3s linear both",
      "none",
    ]);
  });
});
