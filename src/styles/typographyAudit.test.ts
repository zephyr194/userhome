/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");
const srcRoot = fileURLToPath(new URL("../", import.meta.url));

function tokenPx(name: string): number {
  const match = CSS.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px;`));
  if (!match) throw new Error(`missing px token --${name}`);
  return Number(match[1]);
}

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

const READING_TOKENS = [
  { name: "meta", font: 10.5, line: 16, minRatio: 1.4 },
  { name: "aux", font: 11, line: 17, minRatio: 1.45 },
  { name: "body", font: 12, line: 19, minRatio: 1.45 },
  { name: "code", font: 12, line: 18, minRatio: 1.45 },
] as const;

const HEADING_TOKENS = [
  { name: "group", font: 13, line: 20 },
  { name: "page-title", font: 17, line: 24 },
] as const;

const SELECTION_TEXT_RATIO = 1.2;
const MIN_ROW_GAP_PX = 2;

describe("文字令牌行高（r8-type）", () => {
  it.each(READING_TOKENS)("$name 为阅读文本：字号与行高均为 px 令牌，比值达到阈值", ({ name, font, line, minRatio }) => {
    expect(tokenPx(`app-font-size-${name}`)).toBe(font);
    expect(tokenPx(`app-line-height-${name}`)).toBe(line);
    expect(line / font).toBeGreaterThanOrEqual(minRatio);
  });

  it.each(HEADING_TOKENS)("$name 为标题：按现有字号 ×1.3 设定，比值不低于 1.25", ({ name, font, line }) => {
    expect(tokenPx(`app-font-size-${name}`)).toBe(font);
    expect(tokenPx(`app-line-height-${name}`)).toBe(line);
    expect(line / font).toBeGreaterThanOrEqual(1.25);
  });

  it("阅读文本相邻行的选中块之间保留至少 2px 行缝（按字号 ×1.2 估算内容区）", () => {
    for (const { name, font, line } of READING_TOKENS) {
      const gap = line - font * SELECTION_TEXT_RATIO;
      expect(gap, name).toBeGreaterThanOrEqual(MIN_ROW_GAP_PX);
    }
  });

  it("Tailwind 默认 text-xs / text-sm 的行高被令牌覆盖，不再是 1.33 / 1.43", () => {
    expect(CSS).toMatch(/--text-xs:\s*var\(--app-font-size-aux\);/);
    expect(CSS).toMatch(/--text-xs--line-height:\s*var\(--app-line-height-aux\);/);
    expect(CSS).toMatch(/--text-sm:\s*var\(--app-font-size-group\);/);
    expect(CSS).toMatch(/--text-sm--line-height:\s*var\(--app-line-height-group\);/);
  });

  it("body 使用无单位倍数，避免 px 行高被子元素原样继承", () => {
    expect(ruleBody("body")).toMatch(/line-height:\s*1\.5;/);
  });

  it("caddy 状态与提示不再用字号乘行高的 calc 计算", () => {
    expect(CSS).not.toMatch(/calc\(\s*var\(--app-font-size-[a-z-]+\)\s*\*\s*var\(--app-line-height-/);
  });
});

describe("代码区行号与代码行同高（CodeViewer）", () => {
  it("行号、代码列与容器共用 code 行高令牌", () => {
    expect(ruleBody(".r6-code-scroll")).toMatch(/line-height:\s*var\(--app-line-height-code\);/);
    expect(ruleBody(".r6-code-gutter")).toMatch(/line-height:\s*var\(--app-line-height-code\);/);
    expect(ruleBody(".r6-code-text")).toMatch(/min-height:\s*var\(--app-line-height-code\);/);
  });
});

describe("固定高度控件的行高（r8-type 区块）", () => {
  const block = CSS.slice(CSS.indexOf("/* r8-type"), CSS.indexOf("/* /r8-type */"));

  it("r8-type 区块存在且不引入焦点外框、阴影、裁切或渐变", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/outline|box-shadow|clip-path|gradient/);
  });

  it("h-control-md / h-control-sm 行高等于控件高度令牌，单行居中且不被撑高", () => {
    expect(block).toMatch(/\.h-control-md\s*\{[^}]*line-height:\s*var\(--app-control-height-md\);/);
    expect(block).toMatch(/\.h-control-sm\s*\{[^}]*line-height:\s*var\(--app-control-height-sm\);/);
  });

  it("行内 code 跨行时逐段绘制底色，且不新增垂直内边距", () => {
    expect(block).toMatch(/code\s*\{[^}]*box-decoration-break:\s*clone;/);
    expect(block).toMatch(/code\s*\{[^}]*-webkit-box-decoration-break:\s*clone;/);
    expect(block).not.toMatch(/code\s*\{[^}]*padding-(top|bottom):/);
  });
});

const SMALL_LEADING = /(?<![\w-])leading-(none|tight|snug)(?![\w-])/;
const READING_TEXT = /(?<![\w-])text-(meta|aux|body|xs|sm)(?![\w-])/;

function productionTsx(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) productionTsx(path, files);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) files.push(path);
  }
  return files;
}

function layerSpans(text: string, name: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(new RegExp(`@layer ${name}\\s*\\{`, "g"))) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    spans.push([start, i]);
  }
  return spans;
}

describe("全局字号层（RF-2）", () => {
  it("font: inherit 只出现在 @layer base 内，使 text-* 工具类对按钮与输入框生效", () => {
    const spans = layerSpans(CSS, "base");
    const offsets = [...CSS.matchAll(/font:\s*inherit\s*;/g)].map((match) => match.index ?? -1);
    expect(offsets.length).toBeGreaterThan(0);
    for (const offset of offsets) {
      expect(spans.some(([start, end]) => offset > start && offset < end), `offset ${offset}`).toBe(true);
    }
  });
});

describe("多行阅读文本的 leading 覆盖（扫描）", () => {
  it("阅读文本类名不再用小于 1.45 的 leading 覆盖（none / tight / snug）", () => {
    const violations: string[] = [];
    const literal = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
    for (const file of productionTsx(srcRoot)) {
      const key = relative(srcRoot, file).split(sep).join("/");
      for (const match of readFileSync(file, "utf8").matchAll(literal)) {
        const value = match[1] ?? match[2] ?? match[3] ?? "";
        if (READING_TEXT.test(value) && SMALL_LEADING.test(value)) {
          violations.push(`${key}: ${value}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
