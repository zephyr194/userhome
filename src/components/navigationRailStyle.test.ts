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

function lastOf(values: string[]): string {
  return values[values.length - 1];
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

  it("支撑组与连接状态脚注之间、脚注与侧栏底边之间各留 12px，窗口矮时仍是正常流（margin 不重叠）", () => {
    expect(declaredValues(".navigation-rail__group--support", "margin-bottom")).toEqual([
      "var(--app-space-12)",
    ]);
    expect(lastOf(declaredValues(".navigation-rail__status", "margin-bottom"))).toBe(
      "var(--app-space-12)",
    );
    expect(declaredValues(".navigation-rail__status", "position")).toEqual([]);
  });

  it("品牌区下方留 8px，与概览列表之间不靠边", () => {
    expect(declaredValues(".navigation-rail__brand", "margin-bottom")).toEqual([
      "var(--app-space-8)",
    ]);
    expect(declaredValues(".navigation-rail__brand", "position")).toEqual([]);
  });

  it("概览行的左右内边距与其他分组行一致：不单独覆盖内边距", () => {
    expect(lastOf(declaredValues(".navigation-rail a", "padding"))).toBe("0 var(--app-space-8)");
    expect(declaredValues(".navigation-rail__group--overview a", "padding")).toEqual([]);
    expect(declaredValues(".navigation-rail__group--overview a", "padding-inline")).toEqual([]);
    expect(declaredValues(".navigation-rail__group--overview .slide-item", "padding")).toEqual([]);
  });
});

const r10Source = source.slice(source.indexOf("/* r10-nav"), source.indexOf("/* /r10-nav */"));
const r10Css = r10Source.replace(/\/\*[\s\S]*?\*\//g, "");

function blockOf(header: RegExp): string {
  const match = r10Css.match(header);
  if (!match) throw new Error(`r10-nav 区块缺少 ${header}`);
  return match[1];
}

function tokenIn(body: string, token: string): string {
  const match = body.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!match) throw new Error(`缺少令牌 ${token}`);
  return match[1].trim();
}

function r10Declared(selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return [...r10Css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].trim() === selector)
    .flatMap((match) => [...match[2].matchAll(pattern)].map((hit) => hit[1].trim()));
}

// 与 global.css 中的真实令牌一致；下方的断言保证两者不会漂移。
const LIGHT = {
  name: "浅色",
  tokens: blockOf(/:root\s*\{([^}]*)\}/),
  canvas: "#EDF1F5",
  surface: "#F8FAFC",
  surfaceMuted: "#E3E9EF",
  sidebar: "#E9EEF3",
  sidebarHover: "#DCE3EA",
  foreground: "#1D242D",
  selectionFill: "#F8EBE1",
  selectionText: "#A64D1D",
  selectionBorder: "#B65C24",
  primaryIcon: "#B65C24",
};

const DARK_BODIES = [
  blockOf(/:root:not\(\[data-appearance\]\),\s*:root\[data-appearance="system"\]\s*\{([^}]*)\}/),
  blockOf(/:root\[data-appearance="dark"\]\s*\{([^}]*)\}/),
];

const DARK = {
  canvas: "#15191E",
  surface: "#1D2228",
  surfaceMuted: "#262C34",
  sidebar: "#171B20",
  sidebarHover: "#272E37",
  foreground: "#E6EBF1",
  selectionFill: "#3B2A20",
  selectionText: "#F0A060",
  selectionBorder: "#F0A060",
  primaryIcon: "#F0A060",
};

const ORANGE_TOKENS = ["#B65C24", "#F0A060", "#A64D1D", "#E9925E", "#F6BA83", "#F8EBE1", "#3B2A20"];

const SELECTED =
  '[aria-current="true"], [aria-current="page"], [aria-selected="true"], [data-selected="true"]';
const PRIMARY_ITEM = `.slide-list[data-slide-level="primary"]:not([data-slide-axis="x"]) .slide-item:is(${SELECTED})`;
const PRIMARY_INDICATOR =
  '.slide-list[data-slide-level="primary"]:not([data-slide-axis="x"])[data-slide-ready]::before';

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

describe("选中级别样式（r10-nav）", () => {
  const themes = [
    LIGHT,
    ...DARK_BODIES.map((body, index) => ({ ...DARK, name: `深色 ${index + 1}`, tokens: body })),
  ];

  it("对比度参照色与 global.css 中的真实令牌一致", () => {
    for (const value of [
      "--app-canvas: #EDF1F5;",
      "--app-surface: #F8FAFC;",
      "--app-surface-muted: #E3E9EF;",
      "--app-sidebar: #E9EEF3;",
      "--app-sidebar-hover: #DCE3EA;",
      "--app-canvas: #15191E;",
      "--app-surface: #1D2228;",
      "--app-surface-muted: #262C34;",
      "--app-sidebar: #171B20;",
      "--app-sidebar-hover: #272E37;",
      "--app-primary-soft: #F8EBE1;",
      "--app-selection-foreground: #A64D1D;",
      "--app-selection-border: #B65C24;",
      "--app-primary-soft: #3B2A20;",
      "--app-selection-foreground: #F0A060;",
      "--app-selection-border: #F0A060;",
    ]) {
      expect(source, value).toContain(value);
    }
  });

  it("一级是信号橙浅底（--app-selection），二级是冷灰（--app-selection-secondary），两级颜色不同", () => {
    for (const theme of themes) {
      const secondary = tokenIn(theme.tokens, "--app-selection-secondary");
      expect(secondary, theme.name).not.toBe(theme.selectionFill);
      expect(ORANGE_TOKENS, theme.name).not.toContain(secondary.toUpperCase());
      expect(secondary, theme.name).not.toMatch(/var\(--(app-primary|app-selection-border|r4-signal|app-brand-accent-deep)\)/);
    }
  });

  it("删除 r8 的一级令牌与图标令牌，描边令牌只保留 --app-selection-border", () => {
    expect(source).not.toMatch(/--app-selection-primary/);
    expect(source).not.toMatch(/--app-selection-secondary-border/);
    expect(source).toMatch(/--app-selection-border:\s*#B65C24;/);
  });

  it("一级：橙字在浅底上 ≥4.5:1（浅色与深色）", () => {
    for (const theme of themes) {
      expect(contrast(theme.selectionText, theme.selectionFill), theme.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("一级：1px 描边相对侧栏 ≥3:1，图标相对浅底 ≥3:1（浅色与深色）", () => {
    for (const theme of themes) {
      expect(contrast(theme.selectionBorder, theme.sidebar), `${theme.name} 描边`).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.primaryIcon, theme.selectionFill), `${theme.name} 图标`).toBeGreaterThanOrEqual(3);
    }
  });

  it("二级：前景文字 ≥4.5:1，底色相对页面与面板 ≥1.15:1，且比列表悬停底色更深", () => {
    for (const theme of themes) {
      const secondary = tokenIn(theme.tokens, "--app-selection-secondary");
      expect(contrast(theme.foreground, secondary), `${theme.name} 文字`).toBeGreaterThanOrEqual(4.5);
      for (const page of [theme.canvas, theme.surface]) {
        expect(contrast(secondary, page), `${theme.name} 底色/页面`).toBeGreaterThanOrEqual(1.15);
        expect(contrast(secondary, page), `${theme.name} 比悬停更深`).toBeGreaterThan(
          contrast(theme.surfaceMuted, page),
        );
      }
    }
  });

  it("一级指示器：浅橙底 + 1px 内描边，不用外阴影", () => {
    expect(lastOf(r10Declared(PRIMARY_INDICATOR, "background"))).toBe("var(--app-selection)");
    expect(lastOf(r10Declared(PRIMARY_INDICATOR, "box-shadow"))).toBe(
      "inset 0 0 0 1px var(--app-selection-border)",
    );
  });

  it("一级选中项：橙字用 --app-selection-foreground，字重沿用基础样式的 600", () => {
    expect(lastOf(r10Declared(PRIMARY_ITEM, "color"))).toBe("var(--app-selection-foreground)");
    expect(r10Declared(PRIMARY_ITEM, "font-weight")).toEqual([]);
  });

  it("一级未就绪时的回退与就绪态一致：浅橙底 + 1px 内描边", () => {
    const fallback = [
      ...r10Css.matchAll(
        /\.slide-list\[data-slide-level="primary"\]:not\(\[data-slide-axis="x"\]\):not\(\[data-slide-ready\]\) \.slide-item:is\([^{]*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.join("\n")).toMatch(/background:\s*var\(--app-selection\);/);
    expect(fallback.join("\n")).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--app-selection-border\);/);
  });

  it("一级图标不再单独上色，沿用基础的 --app-primary 图标色", () => {
    expect(r10Css).not.toContain(".navigation-rail__icon");
    expect(r10Css).not.toContain("--app-selection-primary-icon");
  });

  it("切换语言等非选中变化时关闭指示器过渡，位置立即到位", () => {
    expect(
      lastOf(r10Declared(".slide-list[data-slide-instant][data-slide-ready]::before", "transition")),
    ).toBe("none");
  });
});

describe("侧栏概览分组", () => {
  it("概览分组贴顶，不借用支撑组的 margin-top:auto 被推到底部", () => {
    expect(declaredValues(".navigation-rail__group--overview", "margin-top")).toEqual([]);
    expect(declaredValues(".navigation-rail__group--overview", "position")).toEqual([]);
  });

  it("概览组与下一组（系统工具）之间留 12px：概览组下边距 12px，下一组标题不再叠加上边距", () => {
    expect(declaredValues(".navigation-rail__group--overview", "margin-bottom")).toEqual([
      "var(--app-space-12)",
    ]);
    expect(
      declaredValues(
        ".navigation-rail__group--overview + .navigation-rail__group > .navigation-rail__section-label",
        "margin-top",
      ),
    ).toEqual(["0"]);
  });

  it("窄窗口下 ul 的上边距不叠加到概览与其后的分组上，间距仍只来自上面的令牌", () => {
    expect(declaredValues(".navigation-rail__group--overview > ul", "margin-top")).toEqual(["0"]);
    expect(
      declaredValues(".navigation-rail__group--overview + .navigation-rail__group > ul", "margin-top"),
    ).toEqual(["0"]);
  });
});
