/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Variant[] = ["primary", "secondary", "danger", "ghost"];

function classesOf(markup: string): string[] {
  const match = markup.match(/class="([^"]*)"/);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function renderVariant(variant: Variant, disabled = false): string {
  return renderToStaticMarkup(
    <Button variant={variant} disabled={disabled}>
      文案
    </Button>,
  );
}

describe("Button variant 层级", () => {
  it("四种 variant 的 class 集合两两不同", () => {
    const sets = VARIANTS.map((variant) => classesOf(renderVariant(variant)).join(" "));
    expect(new Set(sets).size).toBe(VARIANTS.length);
  });

  it("primary 是信号橙实底", () => {
    const classes = classesOf(renderVariant("primary"));
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
  });

  it("secondary 是控件边框加表面底", () => {
    const classes = classesOf(renderVariant("secondary"));
    expect(classes).toContain("border-control-border");
    expect(classes).toContain("bg-surface");
  });

  it("ghost 没有边框色，只保留透明边框占位", () => {
    const classes = classesOf(renderVariant("ghost"));
    expect(classes).toContain("border-transparent");
    expect(classes).not.toContain("border-control-border");
    expect(classes.some((name) => /^border-(danger|primary|control)/.test(name))).toBe(false);
    expect(classes).toContain("bg-transparent");
  });

  it("danger 是危险色实底", () => {
    const classes = classesOf(renderVariant("danger"));
    expect(classes).toContain("bg-danger");
    expect(classes).toContain("text-danger-foreground");
  });

  it("disabled 时仍带有各自 variant 的类，不会变成同一个外观", () => {
    const expected: Record<Variant, string> = {
      primary: "bg-primary",
      secondary: "border-control-border",
      danger: "bg-danger",
      ghost: "bg-transparent",
    };
    for (const variant of VARIANTS) {
      const classes = classesOf(renderVariant(variant, true));
      expect(classes).toContain(expected[variant]);
      expect(classes).toContain("disabled:opacity-50");
    }
  });

  it("forced-colors 下实心按钮补可见外框", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "global.css"), "utf8");
    const block = css.match(/@media \(forced-colors: active\)\s*\{\s*\.r12-btn--primary,\s*\.r12-btn--danger\s*\{\s*border-color:\s*ButtonText;/);
    expect(block).not.toBeNull();
  });
});
