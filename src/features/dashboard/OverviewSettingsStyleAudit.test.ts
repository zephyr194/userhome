/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const AUDITED_DIRS = ["dashboard", "settings", "grants", "operations"];

const ALLOWED_RADIUS_SIZES = new Set(["none", "sm", "control", "panel"]);
const RADIUS =
  /^rounded(?:-(?:tl|tr|br|bl|ss|se|ee|es|ts|te|bs|be|t|r|b|l|s|e))?(?:-(.+))?$/;
const SPACING = /^-?(?:p[xytblre]?|m[xytblre]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const SPACING_VALUE = /^(?:ui-|0$|auto$)/;
const CONTROL_HEIGHT = /^(?:min-)?h-control-(?:sm|md)$/;
const VERTICAL_PADDING = /^(?:py|pt|pb)-/;
const HARD_HEIGHT = /^(?:min-)?h-(?!0$)(?:\d|\[)/;
const PALETTE_COLOR =
  /^(?:bg|text|border|ring|fill|stroke|outline|decoration|accent|caret|placeholder|divide)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?$/;
const DECORATIVE =
  /^(?:bg-(?:gradient|linear|radial|conic)-|(?:drop-)?shadow(?:-(?:xs|sm|md|lg|xl|2xl))?$)/;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch)\(/;
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const PANEL_OPEN = /<Panel\b[^>]*>/g;
const MAX_TICKED_PANELS = 2;

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

function auditedTsx(): { dir: string; file: string }[] {
  return AUDITED_DIRS.flatMap((dir) =>
    productionTsx(join(srcRoot, "features", dir)).map((file) => ({ dir, file })),
  );
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

describe("概览与设置相关页面样式审计（UI-3a）", () => {
  it("圆角类只用 none/sm/control/panel；无 lg/xl/2xl/3xl、任意值或 rounded-full", () => {
    const violations: string[] = [];
    for (const { file } of auditedTsx()) {
      for (const group of classGroups(readFileSync(file, "utf8"))) {
        for (const token of group) {
          const match = RADIUS.exec(token);
          if (!match) continue;
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
    for (const { file } of auditedTsx()) {
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

  it("无写死颜色字面量、默认调色板色、渐变与装饰阴影", () => {
    const violations: string[] = [];
    for (const { file } of auditedTsx()) {
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

  it("间距类只用 ui-* 令牌（或 0/auto），无任意像素与默认刻度", () => {
    const violations: string[] = [];
    for (const { file } of auditedTsx()) {
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

  it("每个页面目录启用角标（ticks）的 Panel 不超过 2 个", () => {
    const tickedPerDir = new Map<string, number>();
    for (const { dir, file } of auditedTsx()) {
      const ticked = Array.from(
        readFileSync(file, "utf8").matchAll(PANEL_OPEN),
        (match) => match[0],
      ).filter((tag) => /\bticks\b/.test(tag)).length;
      tickedPerDir.set(dir, (tickedPerDir.get(dir) ?? 0) + ticked);
    }
    for (const [dir, count] of tickedPerDir) {
      expect(count, dir).toBeLessThanOrEqual(MAX_TICKED_PANELS);
    }
  });
});
