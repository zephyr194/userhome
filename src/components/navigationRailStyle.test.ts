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

  it("支撑组与连接状态脚注之间、脚注与侧栏底边之间各留 12px，窗口矮时仍是正常流（margin 不重叠）", () => {
    expect(declaredValues(".navigation-rail__group--support", "margin-bottom")).toEqual([
      "var(--app-space-12)",
    ]);
    expect(lastOf(declaredValues(".navigation-rail__status", "margin-bottom"))).toBe(
      "var(--app-space-12)",
    );
    expect(declaredValues(".navigation-rail__status", "position")).toEqual([]);
  });
});

const r8Source = source.slice(source.indexOf("/* r8-nav"), source.indexOf("/* /r8-nav */"));
const r8Css = r8Source.replace(/\/\*[\s\S]*?\*\//g, "");

function blockOf(header: RegExp): string {
  const match = r8Css.match(header);
  if (!match) throw new Error(`r8-nav 区块缺少 ${header}`);
  return match[1];
}

function tokenIn(body: string, token: string): string {
  const match = body.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!match) throw new Error(`缺少令牌 ${token}`);
  return match[1].trim();
}

function r8Declared(selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return [...r8Css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
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

describe("选中级别样式（r8-nav）", () => {
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
    ]) {
      expect(source, value).toContain(value);
    }
  });

  it("一级与二级各自定义填充令牌，两级互不相同，二级不使用橙色", () => {
    for (const theme of themes) {
      const primary = tokenIn(theme.tokens, "--app-selection-primary");
      const secondary = tokenIn(theme.tokens, "--app-selection-secondary");
      expect(primary, theme.name).not.toBe(secondary);
      expect(ORANGE_TOKENS, theme.name).not.toContain(secondary.toUpperCase());
      expect(secondary, theme.name).not.toMatch(/var\(--(app-primary|app-selection-border|r4-signal|app-brand-accent-deep)\)/);
    }
  });

  it("不再定义描边令牌：一级与二级的 -border 令牌已删除，横向标签页下划线令牌保留", () => {
    expect(source).not.toMatch(/--app-selection-(primary|secondary)-border/);
    expect(source).toMatch(/--app-selection-border:\s*#B65C24;/);
  });

  it("一级：白色文字在实心钢色底上 ≥4.5:1，底色相对侧栏 ≥3:1，橙色图标相对底色 ≥3:1", () => {
    for (const theme of themes) {
      const primary = tokenIn(theme.tokens, "--app-selection-primary");
      const text = tokenIn(theme.tokens, "--app-selection-primary-foreground");
      const icon = tokenIn(theme.tokens, "--app-selection-primary-icon");
      expect(contrast(text, primary), `${theme.name} 文字`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(primary, theme.sidebar), `${theme.name} 底色`).toBeGreaterThanOrEqual(3);
      expect(contrast(icon, primary), `${theme.name} 图标`).toBeGreaterThanOrEqual(3);
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

  it("指示器按级别取填充：一级覆盖为一级填充，两级都不画描边（二级默认值在选中语言区块中断言）", () => {
    expect(r8Declared(".slide-list[data-slide-ready]::before", "box-shadow")).toEqual([]);
    expect(
      r8Declared(
        '.slide-list[data-slide-level="primary"]:not([data-slide-axis="x"])[data-slide-ready]::before',
        "background",
      ),
    ).toEqual(["var(--app-selection-primary)"]);
    expect(
      r8Declared(
        '.slide-list[data-slide-level="primary"]:not([data-slide-axis="x"])[data-slide-ready]::before',
        "box-shadow",
      ),
    ).toEqual([]);
  });

  it("一级选中项文字与图标用一级前景与图标令牌，二级选中项用前景色", () => {
    const primaryItem =
      '.slide-list[data-slide-level="primary"]:not([data-slide-axis="x"]) .slide-item:is([aria-current="true"], [aria-current="page"], [aria-selected="true"], [data-selected="true"])';
    expect(lastOf(r8Declared(primaryItem, "color"))).toBe("var(--app-selection-primary-foreground)");
    const primaryIcon =
      '.navigation-rail .slide-item:is([aria-current="true"], [aria-current="page"], [aria-selected="true"], [data-selected="true"]) .navigation-rail__icon';
    expect(lastOf(r8Declared(primaryIcon, "color"))).toBe("var(--app-selection-primary-icon)");
  });

  it("一级未就绪时的回退与就绪态一致：实心一级底色，不画描边", () => {
    const fallback = [
      ...r8Css.matchAll(
        /\.slide-list\[data-slide-level="primary"\]:not\(\[data-slide-axis="x"\]\):not\(\[data-slide-ready\]\)[^{]*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);
    expect(fallback.length).toBeGreaterThan(0);
    for (const body of fallback) {
      expect(body).not.toMatch(/box-shadow:/);
      expect(body).not.toMatch(/(^|[\s;])border(-[a-z-]+)?:/);
    }
    expect(fallback.join("\n")).toMatch(/background:\s*var\(--app-selection-primary\)/);
  });

  it("forced-colors 下用 Highlight 1px 边框代替被系统忽略的底色，写在选中项上而非隐藏的指示器上", () => {
    const forced = r8Source.match(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/);
    expect(forced).not.toBeNull();
    const body = forced?.[1] ?? "";
    expect(body).toMatch(
      /\.slide-list\[data-slide-level="primary"\]:not\(\[data-slide-axis="x"\]\) \.slide-item:is\(/,
    );
    expect(body).toMatch(/border:\s*1px solid Highlight;/);
    expect(body).not.toMatch(/2px solid Highlight/);
  });
});

describe("侧栏概览分组", () => {
  it("概览分组贴顶，不借用支撑组的 margin-top:auto 被推到底部", () => {
    expect(declaredValues(".navigation-rail__group--overview", "margin-top")).toEqual([]);
    expect(declaredValues(".navigation-rail__group--overview", "margin-bottom")).toEqual([]);
  });
});
