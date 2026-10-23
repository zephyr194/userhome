/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const AUDITED_DIR = join(srcRoot, "features", "caddy");
const globalCss = readFileSync(join(srcRoot, "styles", "global.css"), "utf8");

const ALLOWED_RADIUS_SIZES = new Set(["none", "sm", "control", "panel"]);
const RADIUS =
  /^rounded(?:-(?:tl|tr|br|bl|ss|se|ee|es|ts|te|bs|be|t|r|b|l|s|e))?(?:-(.+))?$/;
const SPACING = /^-?(?:p[xytblre]?|m[xytblre]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const SPACING_VALUE = /^(?:ui-|0$|auto$|px$)/; // px：1px 发丝分隔线（gap-px + bg-border），规格允许的细线
const CONTROL_HEIGHT = /^(?:min-)?h-(?:control-(?:sm|md)|status-badge)$/;
const VERTICAL_PADDING = /^(?:py|pt|pb)-/;
const HARD_HEIGHT = /^(?:min-)?h-(?!0$)(?:\d|\[)/;
const ARBITRARY_MAX_HEIGHT = /^max-h-\[/;
const PALETTE_COLOR =
  /^(?:bg|text|border|ring|fill|stroke|outline|decoration|accent|caret|placeholder|divide)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?$/;
const DECORATIVE =
  /^(?:bg-(?:gradient|linear|radial|conic)-|(?:drop-)?shadow(?:-(?:xs|sm|md|lg|xl|2xl))?$)/;
const COLOR_UTILITY = /^(?:bg|text|border|ring|outline|fill|stroke|divide|decoration|accent|caret)-(.+)$/;
const NON_COLOR_VALUE =
  /^(?:\d+|inset|[trblxyse]|left|center|right|justify|start|end|balance|pretty|ellipsis|wrap|nowrap|none|auto|current|transparent|inherit|xs|sm|base|lg|xl|\dxl|clip(?:-.+)?|linear-.+|radial-.+|conic-.+)$/;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch)\(/;
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const PANEL_OPEN = /<Panel\b[^>]*>/g;
// 与 `>=` 同形的比较运算不能被当作标签结束，否则会截断 Button 的属性
const BUTTON_OPEN = /<Button\b(?:=>|>=|[^>])*>/g;
const MAX_TICKED_PANELS = 2;

const DEFINED_COLORS = new Set(Array.from(globalCss.matchAll(/--color-([a-z0-9-]+):/g), (m) => m[1]));
const TEXT_SIZES = new Set(Array.from(globalCss.matchAll(/--text-([a-z0-9-]+):/g), (m) => m[1]));

function productionTsx(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) productionTsx(path, files);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function rel(file: string): string {
  return relative(srcRoot, file).split(sep).join("/");
}

function classGroups(source: string): string[][] {
  return Array.from(source.matchAll(STRING_LITERAL), (match) =>
    (match[1] ?? match[2] ?? match[3] ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.split(":").pop() ?? token),
  );
}

function isDefinedColorValue(value: string): boolean {
  return DEFINED_COLORS.has(value) || TEXT_SIZES.has(value) || NON_COLOR_VALUE.test(value);
}

const files = productionTsx(AUDITED_DIR);

describe("Caddy 页样式审计（UI-3d）", () => {
  it("扫描到 Caddy 页生产 TSX", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("圆角类只用 none/sm/control/panel；无 lg/xl/2xl/3xl、任意值或 rounded-full", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        const isLoadingRing = group.includes("animate-spin");
        for (const token of group) {
          const match = RADIUS.exec(token);
          if (!match) continue;
          if (match[1] === "full" && isLoadingRing) continue;
          if (!ALLOWED_RADIUS_SIZES.has(match[1] ?? "")) {
            violations.push(`${rel(file)}: ${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("控件高度令牌不与 py/pt/pb 同用，且不写死 h-N 或 min-h-[…]", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        const hasControlHeight = group.some((token) => CONTROL_HEIGHT.test(token));
        const hasVerticalPadding = group.some((token) => VERTICAL_PADDING.test(token));
        if (hasControlHeight && hasVerticalPadding) {
          violations.push(`${rel(file)}: ${group.join(" ")}`);
        }
        for (const token of group) {
          if (HARD_HEIGHT.test(token)) violations.push(`${rel(file)}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("Button 标签不带垂直内边距（高度由 sm/md 令牌决定，跨属性也不并用）", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const tag of Array.from(readFileSync(file, "utf8").matchAll(BUTTON_OPEN), (m) => m[0])) {
        const tokens = classGroups(tag).flat();
        if (tokens.some((token) => VERTICAL_PADDING.test(token))) {
          violations.push(`${rel(file)}: ${tokens.filter((t) => VERTICAL_PADDING.test(t)).join(" ")}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("无任意值 max-h-[…] 写死高度", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        for (const token of group) {
          if (ARBITRARY_MAX_HEIGHT.test(token)) violations.push(`${rel(file)}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("无写死颜色字面量、默认调色板色、渐变与装饰阴影", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (HEX_COLOR.test(source) || FUNCTIONAL_COLOR.test(source)) {
        violations.push(`${rel(file)}: 字面量颜色`);
      }
      for (const group of classGroups(source)) {
        for (const token of group) {
          if (PALETTE_COLOR.test(token) || DECORATIVE.test(token)) {
            violations.push(`${rel(file)}: ${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("颜色类只用 global.css 已定义的语义令牌，不出现未定义或任意值颜色", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        for (const token of group) {
          const match = COLOR_UTILITY.exec(token);
          if (!match) continue;
          const value = match[1].replace(/\/\d+$/, "");
          if (value.startsWith("[") || !isDefinedColorValue(value)) {
            violations.push(`${rel(file)}: ${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("间距类只用 ui-* 令牌（或 0/auto），无任意像素与默认刻度", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        for (const token of group) {
          const match = SPACING.exec(token);
          if (match && !SPACING_VALUE.test(match[1])) {
            violations.push(`${rel(file)}: ${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("启用角标（ticks）的 Panel 不超过 2 个", () => {
    const ticked = files.flatMap((file) =>
      Array.from(readFileSync(file, "utf8").matchAll(PANEL_OPEN), (match) => match[0]).filter(
        (tag) => /\bticks\b/.test(tag),
      ),
    );
    expect(ticked.length).toBeLessThanOrEqual(MAX_TICKED_PANELS);
  });

  it("同排的 TLS 文件选择与上游删除按钮与输入同档（md），不使用 sm", () => {
    const rules = readFileSync(join(AUDITED_DIR, "CaddyRulesEditor.tsx"), "utf8");
    const tags = Array.from(rules.matchAll(BUTTON_OPEN), (m) => m[0]);
    const sameRowButtons = tags.filter(
      (tag) => tag.includes("onClick={onPick}") || tag.includes("caddy.rules.deleteUpstream"),
    );
    expect(sameRowButtons).toHaveLength(2);
    for (const tag of sameRowButtons) {
      expect(tag).not.toContain('size="sm"');
    }
  });
});
