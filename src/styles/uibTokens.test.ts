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

describe("4px 栅格间距令牌（UIB-0）", () => {
  it("新增档位恰为 2/4/8/12/16/24px", () => {
    for (const step of SPACE_STEPS) {
      expect(tokenValue(`app-space-${step}`)).toBe(`${step}px`);
    }
  });

  it("旧令牌别名指向最近的新档位（迁移期保留，UIB-5 删除）", () => {
    const aliases: Record<string, number> = {
      xxs: 2,
      xs: 4,
      sm: 8,
      md: 8,
      lg: 8,
      xl: 12,
      "2xl": 12,
      "3xl": 16,
    };
    for (const [name, step] of Object.entries(aliases)) {
      expect(tokenValue(`app-space-${name}`)).toBe(`var(--app-space-${step})`);
    }
  });

  it("Tailwind 间距映射暴露新档位，使 gap-ui-12 等类可用", () => {
    for (const step of SPACE_STEPS) {
      expect(css).toContain(`--spacing-ui-${step}: var(--app-space-${step});`);
    }
  });
});

describe("圆角令牌（UIB-0）", () => {
  it("控件 3px、容器 4px，面板指向容器令牌", () => {
    expect(tokenValue("app-radius-control")).toBe("3px");
    expect(tokenValue("app-radius-container")).toBe("4px");
    expect(tokenValue("app-radius-panel")).toBe("var(--app-radius-container)");
  });

  it("Tailwind 圆角映射按控件与容器令牌取值", () => {
    expect(tokenValue("radius-sm")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-md")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-lg")).toBe("var(--app-radius-container)");
  });
});
