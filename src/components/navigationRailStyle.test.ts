/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(srcRoot, "styles/global.css"), "utf8");
const css = source.replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rulesFor(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").map((part) => part.trim()).includes(selector),
    )
    .map((match) => match[2]);
}

function declaredValues(selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return rulesFor(selector).flatMap((body) =>
    [...body.matchAll(pattern)].map((match) => match[1].trim()),
  );
}

describe("侧栏样式审计", () => {
  it("导航项的 ::before 不再绘制竖条（无任何规则）", () => {
    expect(rulesFor(".navigation-rail a::before")).toEqual([]);
  });

  it("导航项与当前项自身不画底色阴影或左侧边框，选中框只由 .slide-list 的 ::before 承担", () => {
    for (const selector of [
      ".navigation-rail a",
      '.navigation-rail a[aria-current="page"]',
      ".navigation-rail .slide-item",
    ]) {
      expect(declaredValues(selector, "box-shadow"), selector).toEqual([]);
      expect(declaredValues(selector, "border-left"), selector).toEqual([]);
      expect(declaredValues(selector, "border-inline-start"), selector).toEqual([]);
    }
  });

  it("侧栏自身是唯一的纵向滚动容器，分组列表不再各自滚动或伸缩", () => {
    const railOverflow = declaredValues(".navigation-rail", "overflow-y");
    expect(railOverflow[railOverflow.length - 1]).toBe("auto");
    expect(declaredValues(".navigation-rail ul", "overflow-y")).toEqual([]);
    expect(declaredValues(".navigation-rail ul", "flex")).toEqual([]);
  });

  it("侧栏容器是指示器的定位上下文", () => {
    expect(declaredValues(".slide-list", "position")).toContain("relative");
  });

  it("分组标题为 11px 的 muted 小字，不全大写、不加字距，且不参与定位（不打断选中框测量）", () => {
    const label = ".navigation-rail__section-label";
    expect(declaredValues(label, "font-size")).toEqual(["var(--app-font-size-meta)"]);
    expect(declaredValues(label, "color")).toEqual(["var(--app-muted-foreground)"]);
    expect(declaredValues(label, "text-transform")).toEqual([]);
    expect(declaredValues(label, "letter-spacing")).toEqual([]);
    expect(declaredValues(label, "position")).toEqual(["absolute"]);
    expect(declaredValues(".navigation-rail ul", "position")).toEqual([]);
  });

  it("支撑分组外层贴底（margin-top:auto），分组外层不参与定位，页脚不再自行推底", () => {
    expect(declaredValues(".navigation-rail__group--support", "margin-top")).toEqual(["auto"]);
    expect(declaredValues(".navigation-rail__group", "position")).toEqual([]);
    expect(lastOf(declaredValues(".navigation-rail__status", "margin-top"))).toBe("0");
  });
});

const r7Block = source
  .slice(source.indexOf("/* r7-nav"), source.indexOf("/* /r7-nav */"))
  .replace(/\/\*[\s\S]*?\*\//g, "");

function blockOf(header: RegExp): string {
  const match = r7Block.match(header);
  if (!match) throw new Error(`r7-nav 区块缺少 ${header}`);
  return match[1];
}

function tokenIn(body: string, token: string): string {
  const match = body.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!match) throw new Error(`缺少令牌 ${token}`);
  return match[1].trim();
}

// 与 global.css 中的真实令牌一致；下方的断言保证两者不会漂移。
const LIGHT = {
  tokens: blockOf(/:root\s*\{([^}]*)\}/),
  canvas: "#EDF1F5",
  sidebar: "#E9EEF3",
  hover: "#DCE3EA",
  foreground: "#1D242D",
  signal: "#B65C24",
};

const DARK_BODIES = [
  blockOf(/:root:not\(\[data-appearance\]\),\s*:root\[data-appearance="system"\]\s*\{([^}]*)\}/),
  blockOf(/:root\[data-appearance="dark"\]\s*\{([^}]*)\}/),
];

const DARK = {
  canvas: "#15191E",
  sidebar: "#171B20",
  hover: "#272E37",
  foreground: "#E6EBF1",
  signal: "#F0A060",
};

const ORANGE_TOKENS = ["#B65C24", "#F0A060", "#A64D1D", "#E9925E", "#F6BA83", "#F8EBE1", "#3B2A20"];

function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function lastOf(values: string[]): string {
  return values[values.length - 1];
}

describe("选中级别样式", () => {
  const themes = [
    { name: "浅色", ...LIGHT },
    ...DARK_BODIES.map((body, index) => ({
      name: `深色 ${index + 1}`,
      ...DARK,
      tokens: body,
    })),
  ];

  it("对比度参照色与 global.css 中的真实令牌一致", () => {
    for (const value of [
      "--app-canvas: #EDF1F5;",
      "--app-sidebar: #E9EEF3;",
      "--app-sidebar-hover: #DCE3EA;",
      "--app-canvas: #15191E;",
      "--app-sidebar: #171B20;",
      "--app-sidebar-hover: #272E37;",
    ]) {
      expect(source, value).toContain(value);
    }
  });

  it("一级与二级令牌在浅色与两套深色下各自定义，二级不使用橙色", () => {
    for (const theme of themes) {
      const primary = tokenIn(theme.tokens, "--app-selection-primary");
      const primaryBorder = tokenIn(theme.tokens, "--app-selection-primary-border");
      const secondary = tokenIn(theme.tokens, "--app-selection-secondary");
      const secondaryBorder = tokenIn(theme.tokens, "--app-selection-secondary-border");
      expect(primary, theme.name).not.toBe(secondary);
      expect(primaryBorder, theme.name).not.toBe(secondaryBorder);
      for (const value of [secondary, secondaryBorder]) {
        expect(ORANGE_TOKENS, theme.name).not.toContain(value.toUpperCase());
        expect(value, theme.name).not.toMatch(/var\(--(app-primary|app-selection-border|r4-signal|app-brand-accent-deep)\)/);
      }
    }
  });

  it("一级与二级的对比度：边框对侧栏 ≥3:1，文字 ≥4.5:1，一级底色与侧栏可分辨，二级底色比侧栏 hover 更明显", () => {
    for (const theme of themes) {
      const primary = tokenIn(theme.tokens, "--app-selection-primary");
      const primaryBorder = tokenIn(theme.tokens, "--app-selection-primary-border");
      const secondary = tokenIn(theme.tokens, "--app-selection-secondary");
      const secondaryBorder = tokenIn(theme.tokens, "--app-selection-secondary-border");
      expect(contrast(primaryBorder, theme.sidebar), theme.name).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.signal, primary), `${theme.name} 图标`).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.foreground, primary), theme.name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(primary, theme.sidebar), `${theme.name} 底色`).toBeGreaterThanOrEqual(1.1);
      expect(contrast(secondaryBorder, theme.sidebar), theme.name).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.foreground, secondary), theme.name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(secondary, theme.sidebar), theme.name).toBeGreaterThan(
        contrast(theme.hover, theme.sidebar),
      );
    }
  });

  it("指示器按级别取令牌：一级覆盖底色与边框，二级是默认值，未就绪回退同样按级别", () => {
    expect(declaredValues(".slide-list[data-slide-ready]::before", "background")).toEqual([
      "var(--app-selection-secondary)",
    ]);
    expect(declaredValues('.slide-list[data-slide-level="primary"][data-slide-ready]::before', "background")).toEqual([
      "var(--app-selection-primary)",
    ]);
    expect(declaredValues('.slide-list[data-slide-level="primary"][data-slide-ready]::before', "box-shadow")).toEqual([
      "inset 0 0 0 1px var(--app-selection-primary-border)",
    ]);
    expect(css).toMatch(
      /\.slide-list\[data-slide-level="primary"\]:not\(\[data-slide-ready\]\)[^{]*\{[^}]*background:\s*var\(--app-selection-primary\)/,
    );
  });

  it("横向 tabs 保持 2px 橙色下划线，不随级别变化", () => {
    expect(declaredValues('.slide-list[data-slide-axis="x"][data-slide-ready]::before', "box-shadow")).toEqual([
      "inset 0 -2px 0 var(--app-selection-border)",
    ]);
    expect(declaredValues('.slide-list[data-slide-axis="x"][data-slide-ready]::before', "background")).toEqual([
      "transparent",
    ]);
    expect(declaredValues('.slide-list[data-slide-axis="x"][data-slide-ready]::before', "border-radius")).toEqual([
      "0",
    ]);
  });

  it("选择器选项的选中底色使用二级令牌", () => {
    expect(lastOf(declaredValues('[role="option"][aria-selected="true"]', "background"))).toBe(
      "var(--app-selection-secondary)",
    );
  });
});
