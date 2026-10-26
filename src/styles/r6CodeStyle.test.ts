/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");
const block = css.slice(css.indexOf("/* r6-code"), css.indexOf("/* /r6-code */"));

function declarations(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of body.split(";")) {
    const index = part.indexOf(":");
    if (index !== -1) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function firstBlock(source: string, pattern: RegExp): Record<string, string> {
  const match = source.match(pattern);
  if (!match) throw new Error(`block not found: ${pattern.source}`);
  return declarations(match[1]);
}

const lightSurface = firstBlock(css, /^:root \{([^}]*)\}/m)["--app-surface-muted"];
const darkSurface = firstBlock(css, /^:root\[data-appearance="dark"\] \{([^}]*)\}/m)[
  "--app-surface-muted"
];

const lightCode = firstBlock(css, /^:root \{([^}]*)\}/m);
const darkCode = firstBlock(css, /^:root\[data-appearance="dark"\] \{([^}]*)\}/m);
const systemDarkCode = firstBlock(
  css,
  /@media \(prefers-color-scheme: dark\) \{[\s\S]*?:root:not\(\[data-appearance\]\),\s*:root\[data-appearance="system"\]\s*\{([^}]*)\}/,
);

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const CODE_TOKENS = [
  "--app-code-comment",
  "--app-code-key",
  "--app-code-string",
  "--app-code-number",
  "--app-code-keyword",
  "--app-code-variable",
  "--app-code-section",
  "--app-code-punct",
  "--app-code-gutter",
];

describe("r6-code 高亮令牌", () => {
  it.each([
    ["浅色", lightCode, lightSurface],
    ["深色", darkCode, darkSurface],
    ["跟随系统的深色", systemDarkCode, darkSurface],
  ])("%s外观下每个高亮颜色与代码底色的对比度至少 4.5:1", (_, tokens, surface) => {
    for (const name of CODE_TOKENS) {
      expect(tokens[name], name).toMatch(/^#[0-9A-F]{6}$/i);
      expect(contrast(tokens[name], surface), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("只定义令牌与高亮规则，不添加焦点外框", () => {
    expect(block).not.toMatch(/outline\s*:/);
    expect(block).not.toMatch(/box-shadow\s*:/);
    expect(block).not.toMatch(/!important/);
  });

  it("forced-colors 下使用系统色，并以字重区分段落与注释", () => {
    const forced = block.slice(block.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain("color: CanvasText");
    expect(forced).toContain("font-weight: 600");
  });

  it("行号列不可选中，且对辅助技术隐藏", () => {
    expect(block).toMatch(/\.r6-code-gutter\s*\{[^}]*user-select:\s*none/);
  });
});
