/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

const SPACE_STEPS = [2, 4, 8, 12, 16, 24] as const;
const SPACE_VALUES: Record<(typeof SPACE_STEPS)[number], number> = {
  2: 2,
  4: 6,
  8: 12,
  12: 16,
  16: 24,
  24: 32,
};

describe("4px 栅格间距令牌（UIB-0）", () => {
  it("令牌档位名不变，取值为 2/6/12/16/24/32px", () => {
    for (const step of SPACE_STEPS) {
      expect(tokenValue(`app-space-${step}`)).toBe(`${SPACE_VALUES[step]}px`);
    }
  });

  it("旧令牌别名已删除（UIB-5）", () => {
    for (const name of ["xxs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]) {
      expect(css).not.toContain(`--app-space-${name}:`);
      expect(css).not.toContain(`--spacing-ui-${name}:`);
    }
  });

  it("Tailwind 间距映射暴露新档位，使 gap-ui-12 等类可用", () => {
    for (const step of SPACE_STEPS) {
      expect(css).toContain(`--spacing-ui-${step}: var(--app-space-${step});`);
    }
  });
});

describe("圆角令牌（UIB-0）", () => {
  it("控件 6px、容器 8px，面板指向容器令牌", () => {
    expect(tokenValue("app-radius-control")).toBe("4px");
    expect(tokenValue("app-radius-container")).toBe("8px");
    expect(tokenValue("app-radius-panel")).toBe("var(--app-radius-container)");
  });

  it("Tailwind 圆角映射按控件与容器令牌取值", () => {
    expect(tokenValue("radius-sm")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-md")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-lg")).toBe("var(--app-radius-container)");
  });
});

describe("选中角标令牌（UIB-0）", () => {
  it("虚线框令牌已随滑动指示器删除", () => {
    expect(css).not.toMatch(/--app-selection-dash\s*:/);
  });

  it("选中颜色复用既有令牌，深色主题同样覆盖选中与悬停颜色", () => {
    const darkBlock = css.match(/:root\[data-appearance="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(tokenValue("app-selection")).toBe("var(--app-primary-soft)");
    expect(tokenValue("app-selection-border")).toBe("#B65C24");
    expect(tokenValue("app-control-border")).toBe("#7A8896");
    expect(darkBlock).toMatch(/--app-selection-border:\s*#F0A060;/);
    expect(darkBlock).toMatch(/--app-control-border:\s*#7C8A98;/);
  });

  it("!important 仍恰好 4 处（仅 reduced motion）", () => {
    expect(css.match(/!important/g) ?? []).toHaveLength(4);
  });
});
