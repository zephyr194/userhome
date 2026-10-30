/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_ROUTES,
  primaryNavigationRoutes,
  routeLabel,
} from "../app/routeDefinitions";
import { translate } from "../i18n";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);
const srcRoot = fileURLToPath(new URL("../", import.meta.url));

const ALLOWED_RADIUS_SIZES = new Set(["none", "sm", "md", "control", "panel", "badge"]);
const ALLOWED_CSS_RADII = new Set([
  "0",
  "1px",
  "2px",
  "50%",
  "var(--app-radius-control)",
  "var(--app-radius-container)",
  "var(--app-radius-panel)",
]);
const CIRCULAR_ALLOWLIST: Record<string, number> = {
  "components/ui/forms/index.tsx": 2,
};
const CORNER_PREFIX =
  /^rounded(?:-(?:tl|tr|br|bl|ss|se|ee|es|ts|te|bs|be|t|r|b|l|s|e))?(?:-(.+))?$/;
const RADIUS_CLASS = /(?<![\w-])rounded[\w[\]().%/-]*/g;
/** 导航标签上限，以 1em（一个中文字符宽）为单位计。 */
const NAV_LABEL_MAX_EM = 6;
const NAV_LABEL_FONT_PX = 12;
const SIDEBAR_WIDTH_PX = 188;
const SIDEBAR_PADDING_PX = 12;
const NAV_ICON_PX = 18;

/** 估算标签宽度（em）：CJK 1em，拉丁大写 0.75em，其余拉丁与数字 0.6em，空格 0.3em。 */
function navLabelEm(label: string): number {
  return Array.from(label).reduce((width, char) => {
    if (/\s/.test(char)) return width + 0.3;
    if (/[A-Z]/.test(char)) return width + 0.75;
    if (char.charCodeAt(0) < 0x80) return width + 0.6;
    return width + 1;
  }, 0);
}

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

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

describe("圆角审计（UI-01）", () => {
  it("global.css 的 border-radius 只用 0、1px、2px、圆角令牌或 50%", () => {
    const declared = Array.from(css.matchAll(/border-radius:\s*([^;]+);/g)).map(
      (match) => match[1].trim(),
    );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((value) => !ALLOWED_CSS_RADII.has(value))).toEqual([]);
  });

  it("TSX 圆角类只用 none/sm/md/control/panel，圆形仅限白名单", () => {
    const violations: string[] = [];
    const circular: Record<string, number> = {};
    for (const file of productionTsx(srcRoot)) {
      const key = relative(srcRoot, file).split(sep).join("/");
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/borderRadius|border-radius/);
      for (const [token] of source.matchAll(RADIUS_CLASS)) {
        const size = CORNER_PREFIX.exec(token)?.[1];
        if (size === "full") {
          circular[key] = (circular[key] ?? 0) + 1;
        } else if (!size || !ALLOWED_RADIUS_SIZES.has(size)) {
          violations.push(`${key}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(circular).toEqual(CIRCULAR_ALLOWLIST);
  });

  it("圆角与尺寸令牌取值与 SPEC-ui-refresh 一致", () => {
    expect(tokenValue("radius-sm")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-md")).toBe("var(--app-radius-control)");
    expect(tokenValue("radius-lg")).toBe("var(--app-radius-container)");
    expect(tokenValue("app-radius-control")).toBe("4px");
    expect(tokenValue("app-radius-panel")).toBe("var(--app-radius-container)");
    expect(tokenValue("app-control-height-sm")).toBe("20px");
    expect(tokenValue("app-control-height-md")).toBe("24px");
    expect(tokenValue("app-status-badge-height")).toBe("20px");
    expect(tokenValue("app-row-height-compact")).toBe("32px");
    expect(tokenValue("app-row-height-standard")).toBe("36px");
    expect(tokenValue("app-row-height-two-line")).toBe("52px");
    expect(tokenValue("app-titlebar-height")).toBe("44px");
    expect(tokenValue("app-toolbar-height")).toBe("44px");
    expect(tokenValue("app-sidebar-width")).toBe("188px");
  });

  it("间距与字号令牌取值与 SPEC-ui-refresh 一致", () => {
    expect(tokenValue("app-space-2")).toBe("2px");
    expect(tokenValue("app-space-4")).toBe("6px");
    expect(tokenValue("app-space-8")).toBe("12px");
    expect(tokenValue("app-space-8")).toBe("12px");
    expect(tokenValue("app-space-8")).toBe("12px");
    expect(tokenValue("app-space-12")).toBe("16px");
    expect(tokenValue("app-space-12")).toBe("16px");
    expect(tokenValue("app-space-16")).toBe("24px");
    expect(tokenValue("app-font-size-page-title")).toBe("17px");
    expect(tokenValue("app-font-size-body")).toBe("12px");
  });

  it("阴影去掉装饰层，对话框阴影保持单层", () => {
    expect(tokenValue("app-shadow-sticky")).toBe("none");
    expect(tokenValue("app-shadow-float")).not.toContain(",");
  });

  it("导航标签按显示宽度估算不超过上限", () => {
    const labels = primaryNavigationRoutes(APP_ROUTES).map((route) =>
      routeLabel(route, (key) => translate("zh-CN", key)),
    );
    const longest = Math.max(...labels.map(navLabelEm));
    expect(longest).toBeLessThanOrEqual(NAV_LABEL_MAX_EM);
  });

  it("SKILLHUB 估算宽度落在 188px 侧栏的可用宽度内（真机截断与否待人工确认）", () => {
    const available = SIDEBAR_WIDTH_PX - SIDEBAR_PADDING_PX * 2 - NAV_ICON_PX;
    expect(navLabelEm("SKILLHUB") * NAV_LABEL_FONT_PX).toBeLessThan(available);
  });
});
