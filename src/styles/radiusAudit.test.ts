/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, NAV_GROUPS } from "../app/routeDefinitions";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);
const srcRoot = fileURLToPath(new URL("../", import.meta.url));

const ALLOWED_RADIUS_SIZES = new Set(["none", "sm", "md", "control", "panel"]);
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
const NAV_LABEL_MAX_CHARS = 6;

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
    expect(tokenValue("app-radius-control")).toBe("3px");
    expect(tokenValue("app-radius-panel")).toBe("var(--app-radius-container)");
    expect(tokenValue("app-control-height-sm")).toBe("24px");
    expect(tokenValue("app-control-height-md")).toBe("28px");
    expect(tokenValue("app-status-badge-height")).toBe("18px");
    expect(tokenValue("app-row-height-compact")).toBe("28px");
    expect(tokenValue("app-row-height-standard")).toBe("32px");
    expect(tokenValue("app-row-height-two-line")).toBe("44px");
    expect(tokenValue("app-titlebar-height")).toBe("44px");
    expect(tokenValue("app-toolbar-height")).toBe("44px");
    expect(tokenValue("app-sidebar-width")).toBe("188px");
  });

  it("间距与字号令牌取值与 SPEC-ui-refresh 一致", () => {
    expect(tokenValue("app-space-2")).toBe("2px");
    expect(tokenValue("app-space-4")).toBe("4px");
    expect(tokenValue("app-space-8")).toBe("8px");
    expect(tokenValue("app-space-8")).toBe("8px");
    expect(tokenValue("app-space-8")).toBe("8px");
    expect(tokenValue("app-space-12")).toBe("12px");
    expect(tokenValue("app-space-12")).toBe("12px");
    expect(tokenValue("app-space-16")).toBe("16px");
    expect(tokenValue("app-font-size-page-title")).toBe("18px");
    expect(tokenValue("app-font-size-body")).toBe("13px");
  });

  it("阴影去掉装饰层，对话框阴影保持单层", () => {
    expect(tokenValue("app-shadow-sticky")).toBe("none");
    expect(tokenValue("app-shadow-raised")).not.toContain(",");
  });

  it("导航标签与分组标题不超过侧栏 188px 的字符上限", () => {
    const labels = [
      ...APP_ROUTES.filter((route) => route.group).map((route) => route.label),
      ...NAV_GROUPS.map((group) => group.label),
    ];
    const longest = Math.max(...labels.map((label) => Array.from(label).length));
    expect(longest).toBeLessThanOrEqual(NAV_LABEL_MAX_CHARS);
  });
});
