/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigationRail } from "../components/NavigationRail";
import { APP_ROUTES } from "../app/routeDefinitions";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const selfPath = fileURLToPath(import.meta.url);
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8");

const SECTION_START = "/* selection language */";
const SECTION_END = "/* /selection language */";
const startIndex = css.indexOf(SECTION_START);
const endIndex = css.indexOf(SECTION_END);
const section = startIndex === -1 || endIndex === -1 ? "" : css.slice(startIndex, endIndex);

const SELECTED_STATE =
  '[aria-current="true"], [aria-current="page"], [aria-selected="true"], [data-selected="true"]';
const SELECTED_ITEM = `.slide-item:is(${SELECTED_STATE})`;
const PROGRESSIVE_ITEM = `.slide-list:not([data-slide-ready]) ${SELECTED_ITEM}`;
const READY_CLEARED_ITEM = `.slide-list[data-slide-ready] ${SELECTED_ITEM}`;
const HOVER_ITEM = `.slide-item:hover:not(:is(${SELECTED_STATE}))`;
const INDICATOR = ".slide-list[data-slide-ready]::before";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function rulesFor(source: string, selector: string): string[] {
  return [...stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].trim() === selector)
    .map((match) => match[2]);
}

function declaredIn(source: string, selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return rulesFor(source, selector).flatMap((body) =>
    [...body.matchAll(pattern)].map((match) => match[1].trim()),
  );
}

function lastDeclaredIn(source: string, selector: string, property: string): string {
  const values = declaredIn(source, selector, property);
  if (values.length === 0) throw new Error(`${selector} has no ${property}`);
  return values[values.length - 1];
}

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function toMs(value: string): number {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  if (!match) throw new Error(`unparsed duration ${value}`);
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("选中语言：滑动指示器", () => {
  it("列表容器为定位上下文，指示器是容器的 ::before，位置与尺寸来自 CSS 变量", () => {
    expect(section, "selection language block").not.toBe("");
    expect(lastDeclaredIn(section, ".slide-list", "position")).toBe("relative");
    expect(lastDeclaredIn(section, INDICATOR, "width")).toBe("var(--slide-w)");
    expect(lastDeclaredIn(section, INDICATOR, "height")).toBe("var(--slide-h)");
    expect(lastDeclaredIn(section, INDICATOR, "transform")).toBe(
      "translate(var(--slide-x), var(--slide-y))",
    );
    expect(lastDeclaredIn(section, INDICATOR, "background")).toBe("var(--app-selection)");
    expect(lastDeclaredIn(section, INDICATOR, "box-shadow")).toBe(
      "inset 3px 0 0 var(--app-selection-border)",
    );
    expect(lastDeclaredIn(section, INDICATOR, "pointer-events")).toBe("none");
    expect(
      lastDeclaredIn(section, '.slide-list[data-slide-axis="x"][data-slide-ready]::before', "box-shadow"),
    ).toBe("inset 0 -2px 0 var(--app-selection-border)");
    expect(section).not.toContain("outline");
  });

  it("指示器过渡 120ms、标准曲线，只过渡 transform/width/height", () => {
    expect(lastDeclaredIn(section, INDICATOR, "transition-property")).toBe("transform, width, height");
    expect(lastDeclaredIn(section, INDICATOR, "transition-duration")).toBe("120ms");
    expect(toMs(lastDeclaredIn(section, INDICATOR, "transition-duration"))).toBeLessThanOrEqual(120);
    expect(lastDeclaredIn(section, INDICATOR, "transition-timing-function")).toBe(
      "cubic-bezier(0.2, 0.7, 0.2, 1)",
    );
  });

  it("选中项外框不变：选中态只改底色与阴影，不声明边框宽度、内外边距或轮廓", () => {
    for (const selector of [PROGRESSIVE_ITEM, READY_CLEARED_ITEM]) {
      expect(declaredIn(section, selector, "border")).toEqual([]);
      expect(declaredIn(section, selector, "border-width")).toEqual([]);
      expect(declaredIn(section, selector, "padding")).toEqual([]);
      expect(declaredIn(section, selector, "margin")).toEqual([]);
      expect(declaredIn(section, selector, "outline")).toEqual([]);
    }
    expect(declaredIn(section, SELECTED_ITEM, "border")).toEqual([]);
    expect(declaredIn(section, SELECTED_ITEM, "font-weight")).toEqual(["600"]);
    expect(lastDeclaredIn(section, SELECTED_ITEM, "color")).toBe("var(--app-foreground)");
  });

  it("渐进增强：未就绪时选中项自己绘制浅橙底与色条；就绪后清除，由指示器承担", () => {
    expect(lastDeclaredIn(section, PROGRESSIVE_ITEM, "background")).toBe("var(--app-selection)");
    expect(lastDeclaredIn(section, PROGRESSIVE_ITEM, "box-shadow")).toBe(
      "inset 3px 0 0 var(--app-selection-border)",
    );
    expect(lastDeclaredIn(section, READY_CLEARED_ITEM, "background")).toBe("transparent");
    expect(lastDeclaredIn(section, READY_CLEARED_ITEM, "box-shadow")).toBe("none");
  });

  it("阴影只允许 inset 色条或 none，不出现外阴影或焦点环", () => {
    const values = [...section.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value === "none" || value.startsWith("inset "), value).toBe(true);
    }
  });

  it("悬停仅对非选中项使用悬停底色，无角标与边框", () => {
    expect(lastDeclaredIn(section, HOVER_ITEM, "background")).toBe("var(--app-surface-muted)");
    expect(declaredIn(section, HOVER_ITEM, "border")).toEqual([]);
    expect(declaredIn(section, HOVER_ITEM, "box-shadow")).toEqual([]);
    expect(lastDeclaredIn(css, ".navigation-rail .slide-item:hover:not(:is(" + SELECTED_STATE + "))", "background")).toBe(
      "var(--app-sidebar-hover)",
    );
  });

  it("焦点不画外框（用户 2026-10-22 决定）：选中语言区块不含 focus 选择器", () => {
    expect(section).not.toContain("focus-visible");
    expect(section).not.toMatch(/:focus\b/);
  });

  it("只用令牌与发丝线，不使用 clip-path、负 z-index、!important 与非令牌渐变", () => {
    expect(section).not.toContain("clip-path");
    expect(section).not.toMatch(/z-index:\s*-/);
    expect(section).not.toContain("!important");
    expect(section).not.toMatch(/linear-gradient\((?!var\(--app-)/);
  });
});

describe("选中语言：退化规则", () => {
  it("forced-colors 下隐藏指示器，选中项改用 Highlight 实线（竖向 3px、横向 2px）", () => {
    const forced = section.match(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/);
    expect(forced).not.toBeNull();
    const body = forced?.[1] ?? "";
    expect(body).toMatch(/\.slide-list\[data-slide-ready\]::before\s*\{\s*display:\s*none;/);
    expect(body).toMatch(/border-inline-start:\s*3px solid Highlight/);
    expect(body).toMatch(/border-bottom:\s*2px solid Highlight/);
  });

  it("prefers-reduced-motion 下取消指示器过渡", () => {
    const motion = section.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(motion).not.toBeNull();
    expect(motion?.[1]).toMatch(/\.slide-list\[data-slide-ready\]::before\s*\{[^}]*transition:\s*none/);
  });

  it("选中项文字与指示器过渡都取线性或标准曲线，时长不超过 120ms 状态上限", () => {
    expect(lastDeclaredIn(section, ".slide-item", "transition-duration")).toBe(
      "var(--app-motion-state)",
    );
    expect(toMs(tokenValue("app-motion-state"))).toBeLessThanOrEqual(120);
    expect(lastDeclaredIn(section, ".slide-item", "transition-timing-function")).toBe("linear");
  });
});

describe("选中语言：导航与列表接入", () => {
  it("导航当前项带 slide-item 类且保留 aria-current=page，整个导航共用 slide-list 容器", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationRail, {
        activeRouteId: APP_ROUTES[0].id,
        onNavigate: () => undefined,
        routes: APP_ROUTES,
      }),
    );
    expect(markup).toContain('class="navigation-rail slide-list"');
    const current = markup.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('class="slide-item"');
    expect(markup).not.toContain("data-slide-ready");
  });

  it("导航当前项在 SSR 中不含 data-slide-ready，渐进增强规则仍覆盖其底色与色条", () => {
    expect(css).toMatch(
      /\.slide-list:not\(\[data-slide-ready\]\) \.slide-item:is\([^{]*\)\s*\{[^}]*background:\s*var\(--app-selection\)/,
    );
  });
});

describe("选中语言：退役审计", () => {
  it("退役的角标令牌、类名与虚线选中令牌不再出现在 src 中", () => {
    const hits = sourceFiles(srcRoot)
      .filter((file) => file !== selfPath)
      .filter((file) => /bracket|--app-selection-dash\s*:/.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file));
    expect(hits).toEqual([]);
  });

  it("非测试源码与样式中不使用虚线边框（状态指示器的 loading 虚线除外）", () => {
    const hits = sourceFiles(srcRoot)
      .filter((file) => file !== selfPath)
      .filter((file) => /\.css$|\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => /dashed/.test(line) && !line.includes("navigation-rail__status--loading"))
          .map((line) => `${relative(srcRoot, file)}: ${line.trim()}`),
      );
    expect(hits).toEqual([]);
  });
});
