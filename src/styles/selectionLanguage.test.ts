/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigationRail } from "../components/NavigationRail";
import { APP_ROUTES } from "../app/routeDefinitions";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8");

const SECTION_START = "/* selection language */";
const SECTION_END = "/* /selection language */";
const startIndex = css.indexOf(SECTION_START);
const endIndex = css.indexOf(SECTION_END);
const section = startIndex === -1 || endIndex === -1 ? "" : css.slice(startIndex, endIndex);

const SELECTED = '.bracket[aria-selected="true"]';
const HOVER =
  '.bracket:hover:not([aria-selected="true"]):not([aria-current="true"]):not([aria-current="page"])';
const FOCUS = ".bracket:focus-visible";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function rulesFor(source: string, selector: string): string[] {
  return [...stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",").map((part) => part.trim()).includes(selector))
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

function layerCount(value: string): number {
  return value.split(/,(?![^(]*\))/).filter((layer) => layer.trim() !== "").length;
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

describe("选中语言：令牌化的角标与选中态", () => {
  it("选中态的四个角各由横竖两条实线渐变组成（共 8 层），取值全部来自 bracket 令牌", () => {
    expect(section, "selection language block").not.toBe("");
    const corners = lastDeclaredIn(section, SELECTED, "--bracket-corners");
    expect(corners.match(/linear-gradient\(/g)).toHaveLength(8);
    expect(corners).toContain("var(--app-selection-border)");
    expect(layerCount(lastDeclaredIn(section, SELECTED, "--bracket-sizes"))).toBe(8);
    expect(layerCount(lastDeclaredIn(section, SELECTED, "--bracket-positions"))).toBe(8);
    const sizes = lastDeclaredIn(section, SELECTED, "--bracket-sizes");
    expect(sizes).toContain("var(--app-bracket-length)");
    expect(sizes).toContain("var(--app-bracket-width)");
    expect(lastDeclaredIn(section, SELECTED, "--bracket-positions")).toContain(
      "var(--app-bracket-offset)",
    );
  });

  it("选中态使用浅橙底与 1px 橙色虚线框，且不改变外框尺寸（不用 outline、不用内外边距）", () => {
    const base = section.split("@media")[0];
    expect(lastDeclaredIn(base, SELECTED, "background-color")).toBe("var(--app-selection)");
    const border = lastDeclaredIn(base, SELECTED, "border");
    expect(border).toContain("dashed");
    expect(border).toContain("var(--app-selection-border)");
    expect(border).toContain("var(--app-selection-dash)");
    expect(declaredIn(base, SELECTED, "padding")).toEqual([]);
    expect(declaredIn(base, SELECTED, "margin")).toEqual([]);
    expect(section).not.toContain("outline");
  });

  it("基础态预留与选中态同宽的透明边框，选中时只改边框样式与颜色，避免布局偏移", () => {
    const base = section.split("@media")[0];
    expect(lastDeclaredIn(base, ".bracket", "border")).toBe(
      "var(--app-selection-dash) solid transparent",
    );
    expect(declaredIn(base, SELECTED, "border-width")).toEqual([]);
    expect(lastDeclaredIn(base, SELECTED, "border")).toMatch(/^var\(--app-selection-dash\) dashed /);
  });

  it("选中态不声明阴影，阴影只属于独立的焦点环", () => {
    expect(declaredIn(section, SELECTED, "box-shadow")).toEqual([]);
  });

  it("悬停态仅两个灰色角标（左上与右下），臂长与粗细取悬停令牌", () => {
    const corners = lastDeclaredIn(section, HOVER, "--bracket-corners");
    expect(corners.match(/linear-gradient\(/g)).toHaveLength(4);
    expect(corners).toContain("var(--app-control-border)");
    expect(corners).not.toContain("var(--app-selection-border)");
    const sizes = lastDeclaredIn(section, HOVER, "--bracket-sizes");
    expect(sizes).toContain("var(--app-bracket-length-hover)");
    expect(sizes).toContain("var(--app-bracket-width-hover)");
    expect(layerCount(sizes)).toBe(4);
  });

  it("焦点环是独立的实线 2px 环，偏移 2px，且不与选中规则合并", () => {
    const focus = lastDeclaredIn(section, FOCUS, "box-shadow");
    expect(focus).toContain("var(--app-focus-gap)");
    expect(focus).toContain("var(--app-focus-ring)");
    expect(focus).not.toContain("dashed");
    expect(rulesFor(section, SELECTED).join("\n")).not.toContain("focus");
    expect(rulesFor(section, HOVER).join("\n")).not.toContain("focus");
  });

  it("焦点环叠加时保留 Panel 的发丝线作为第三层，不被覆盖", () => {
    const shadow = lastDeclaredIn(section, FOCUS, "box-shadow");
    expect(layerCount(shadow)).toBe(3);
    expect(shadow).toMatch(/,\s*inset 0 0 0 1px var\(--app-line-subtle\)$/);
  });

  it("只用令牌与发丝线，不使用 clip-path、负 z-index、!important", () => {
    expect(section).not.toContain("clip-path");
    expect(section).not.toMatch(/z-index:\s*-/);
    expect(section).not.toContain("!important");
    expect(section).not.toMatch(/linear-gradient\((?!var\(--app-)/);
  });
});

describe("选中语言：退化规则", () => {
  it("forced-colors 下去掉背景角标，改用 Highlight 的 1px 虚线边框", () => {
    const forced = section.match(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/);
    expect(forced).not.toBeNull();
    const body = forced?.[1] ?? "";
    expect(body).toMatch(/background-image:\s*none/);
    expect(body).toContain("dashed");
    expect(body).toContain("Highlight");
  });

  it("prefers-reduced-motion 下取消过渡", () => {
    const motion = section.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(motion).not.toBeNull();
    expect(motion?.[1]).toMatch(/\.bracket\s*\{[^}]*transition:\s*none/);
  });

  it("过渡时长取状态令牌（≤120ms）且为线性缓动", () => {
    expect(lastDeclaredIn(section, ".bracket", "transition-duration")).toBe(
      "var(--app-motion-state)",
    );
    expect(toMs(tokenValue("app-motion-state"))).toBeLessThanOrEqual(120);
    expect(lastDeclaredIn(section, ".bracket", "transition-timing-function")).toBe("linear");
  });
});

describe("选中语言：导航与 Panel 接入", () => {
  it("导航当前项带 bracket 类，且保留 aria-current=page", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationRail, {
        activeRouteId: APP_ROUTES[0].id,
        onNavigate: () => undefined,
        routes: APP_ROUTES,
      }),
    );
    const current = markup.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('class="bracket"');
  });

  it("导航的 background 简写会重置角标层，悬停与当前态都需恢复 background-image", () => {
    for (const selector of ['.navigation-rail a:hover', '.navigation-rail a[aria-current="page"]']) {
      expect(lastDeclaredIn(css, selector, "background-image"), selector).toBe(
        "var(--bracket-corners)",
      );
      expect(lastDeclaredIn(css, selector, "background-repeat"), selector).toBe("no-repeat");
    }
  });
});
