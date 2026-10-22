/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src", "styles", "global.css"), "utf8");
const BUTTON = readFileSync(join(process.cwd(), "src", "components", "ui", "Button.tsx"), "utf8");

interface CssRule {
  selector: string;
  body: string;
}

function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

const BUTTON_SELECTOR = /button|btn/i;
const OVERFLOW_CLIPPING = /(?:text-overflow\s*:\s*ellipsis|overflow(?:-x|-inline)?\s*:\s*hidden)/i;

describe("按钮文案完整显示", () => {
  it("global.css 中按钮选择器不使用省略号或溢出裁切", () => {
    const offending = cssRules(CSS)
      .filter((rule) => BUTTON_SELECTOR.test(rule.selector) && OVERFLOW_CLIPPING.test(rule.body))
      .map((rule) => rule.selector);
    expect(offending).toEqual([]);
  });

  it("Button 组件不使用省略号、截断或溢出裁切", () => {
    expect(BUTTON).not.toMatch(/\btruncate\b|text-ellipsis|overflow-hidden|overflow-clip/);
  });

  it("Button 组件保持文案单行且不被压缩", () => {
    expect(BUTTON).toMatch(/whitespace-nowrap/);
    expect(BUTTON).toMatch(/shrink-0/);
  });
});

describe("选中外观不使用左侧竖条", () => {
  it("global.css 不包含 inset 3px 左条或 border-inline-start 选中写法", () => {
    expect(CSS).not.toMatch(/inset\s+3px\s+0/);
    expect(CSS).not.toMatch(/border-inline-start:\s*3px/);
  });
});
