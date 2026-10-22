/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const cssPath = fileURLToPath(new URL("./global.css", import.meta.url));
const auditPath = fileURLToPath(import.meta.url);
const css = readFileSync(cssPath, "utf8");

const LEGACY_SPACE_NAMES = ["xxs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
const LEGACY_SPACE = new RegExp(
  `(?:app-space-|-ui-)(?:${LEGACY_SPACE_NAMES.join("|")})(?![\\w-])`,
);
const ARBITRARY_SPACING = /(?<![\w-])(?:p[xytblre]?|m[xytblre]?|gap(?:-[xy])?|space-[xy])-\[/;
const ROUTE_PAGES = [
  "AiConfigPage",
  "AppConfigPage",
  "CaddyPage",
  "DashboardPage",
  "EnvironmentPage",
  "ServicesPage",
  "SettingsPage",
  "ToolsPage",
];
const H1_ALLOWED = new Set(["app/AppShell.tsx", "components/ui/PageShell.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const allFiles = walk(srcRoot).filter((file) => file !== auditPath);
const productionSources = allFiles.filter(
  (file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file),
);
const sourceFiles = allFiles.filter((file) => /\.(tsx?|css)$/.test(file));
const rel = (file: string) => relative(srcRoot, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");

function findPage(name: string): string {
  const file = productionSources.find((candidate) => candidate.endsWith(`/${name}.tsx`));
  if (!file) throw new Error(`missing page ${name}`);
  return file;
}

function directChildFiles(file: string): string[] {
  const children: string[] = [];
  for (const match of read(file).matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
    const base = join(dirname(file), match[1]);
    for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
      if (existsSync(candidate)) children.push(candidate);
    }
  }
  return children;
}

describe("UIB-5 全局审计", () => {
  it("源码与 global.css 不再使用旧间距令牌名", () => {
    const offenders = sourceFiles.filter((file) => LEGACY_SPACE.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("不使用任意数值的间距工具类", () => {
    const offenders = productionSources
      .filter((file) => ARBITRARY_SPACING.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("不使用 clip-path，也没有负 z-index", () => {
    const offenders = productionSources
      .filter((file) => /clip-path|z-\[-|z-index:\s*-/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("border-radius 只使用令牌、0 或 50%", () => {
    const allowed = /^(?:0|50%|var\(--app-radius-(?:control|container|panel)\))$/;
    const declarations = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((match) =>
      match[1].trim(),
    );
    const offenders = declarations.flatMap((value) =>
      value.split(/\s+/).filter((part) => !allowed.test(part)),
    );
    expect(offenders).toEqual([]);
    expect(productionSources.filter((file) => /rounded-\[/.test(read(file))).map(rel)).toEqual(
      [],
    );
  });

  it("!important 全仓恰好 4 处", () => {
    const count = productionSources.reduce(
      (total, file) => total + (read(file).match(/!important/g)?.length ?? 0),
      0,
    );
    expect(count).toBe(4);
  });

  it("每个路由页面的渲染树都使用 PageShell（页面或其直接子视图 import）", () => {
    const missing = ROUTE_PAGES.filter((name) => {
      const page = findPage(name);
      const files = [page, ...directChildFiles(page)];
      return !files.some((file) =>
        /import\s*\{[^}]*\bPageShell\b[^}]*\}\s*from/.test(read(file)),
      );
    });
    expect(missing).toEqual([]);
  });

  it("只有 AppShell 与 PageShell 可以渲染 <h1，页面源码不含 <h1", () => {
    const offenders = productionSources
      .filter((file) => read(file).includes("<h1"))
      .map(rel)
      .filter((file) => !H1_ALLOWED.has(file));
    expect(offenders).toEqual([]);
    for (const name of ROUTE_PAGES) {
      expect(read(findPage(name))).not.toContain("<h1");
    }
  });

  it("窄宽度规则保留：PageShell 容器阈值 960/760、html/body 最小宽 320px、侧栏收为图标栏", () => {
    expect(css).toMatch(/@container \(max-width: 959\.98px\)\s*\{[\s\S]*?\.page-shell__layout--board\s*\{/);
    expect(css).toMatch(/@container \(max-width: 759\.98px\)\s*\{[\s\S]*?\.page-shell__layout--master-detail\s*\{/);
    expect(css).toMatch(/\bhtml\s*\{[^}]*min-width:\s*320px/);
    expect(css).toMatch(/\bbody\s*\{[^}]*min-width:\s*320px/);
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{\s*:root\s*\{\s*--app-sidebar-width:\s*58px/);
  });
});
