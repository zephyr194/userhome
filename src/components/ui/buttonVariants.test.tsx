/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

type Variant = "default" | "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Variant[] = ["default", "primary", "secondary", "danger", "ghost"];
const SIZES: Size[] = ["sm", "md", "lg"];

const SIZE_TOKENS: Record<Size, { height: string; padding: string; text: string }> = {
  sm: { height: "min-h-control-sm", padding: "px-ui-8", text: "text-meta" },
  md: { height: "min-h-control-md", padding: "px-ui-8", text: "text-aux" },
  lg: { height: "min-h-control-lg", padding: "px-ui-12", text: "text-body" },
};

function classesOf(markup: string): string[] {
  const match = markup.match(/class="([^"]*)"/);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function renderVariant(variant: Variant, disabled = false, size: Size = "md"): string {
  return renderToStaticMarkup(
    <Button variant={variant} size={size} disabled={disabled}>
      文案
    </Button>,
  );
}

describe("Button variant 层级", () => {
  it("五种 variant 的 class 集合两两不同", () => {
    const sets = VARIANTS.map((variant) => classesOf(renderVariant(variant)).join(" "));
    expect(new Set(sets).size).toBe(VARIANTS.length);
  });

  it("primary 是信号青实底", () => {
    const classes = classesOf(renderVariant("primary"));
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
  });

  it("secondary 是淡青底加青字，悬停加深淡青", () => {
    const classes = classesOf(renderVariant("secondary"));
    expect(classes).toContain("bg-primary-soft");
    expect(classes).toContain("text-accent-text");
    expect(classes).toContain("enabled:hover:bg-primary-soft-hover");
  });

  it("default 是白底加普通按钮描边，悬停加深描边，不用控件描边", () => {
    const classes = classesOf(renderVariant("default"));
    expect(classes).toContain("bg-surface");
    expect(classes).toContain("border-button-border");
    expect(classes).toContain("enabled:hover:border-button-border-hover");
    expect(classes).not.toContain("border-control-border");
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
      default: "border-button-border",
      primary: "bg-primary",
      secondary: "bg-primary-soft",
      danger: "bg-danger",
      ghost: "bg-transparent",
    };
    for (const variant of VARIANTS) {
      const classes = classesOf(renderVariant(variant, true));
      expect(classes).toContain(expected[variant]);
      expect(classes).toContain("disabled:opacity-50");
    }
  });

  it("默认 variant 为 default，默认尺寸为 md", () => {
    expect(classesOf(renderToStaticMarkup(<Button>文案</Button>))).toEqual(
      classesOf(renderVariant("default", false, "md")),
    );
  });

  it("基础类带 leading-none、gap-ui-4 与 whitespace-nowrap，文字盒居中", () => {
    for (const variant of VARIANTS) {
      const classes = classesOf(renderVariant(variant));
      expect(classes, variant).toContain("leading-none");
      expect(classes, variant).toContain("gap-ui-4");
      expect(classes, variant).toContain("whitespace-nowrap");
    }
  });

  it("三档尺寸的高度、左右内边距与字号类一一对应", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const classes = classesOf(renderVariant(variant, false, size));
        const tokens = SIZE_TOKENS[size];
        expect(classes, `${variant}/${size}`).toContain(tokens.height);
        expect(classes, `${variant}/${size}`).toContain(tokens.padding);
        expect(classes, `${variant}/${size}`).toContain(tokens.text);
        const textClasses = classes.filter((name) => /^text-(meta|aux|body)$/.test(name));
        expect(textClasses, `${variant}/${size}`).toEqual([tokens.text]);
      }
    }
  });

  it("forced-colors 下实心按钮补可见外框", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "global.css"), "utf8");
    const block = css.match(/@media \(forced-colors: active\)\s*\{\s*\.r12-btn--primary,\s*\.r12-btn--danger\s*\{\s*border-color:\s*ButtonText;/);
    expect(block).not.toBeNull();
  });
});
