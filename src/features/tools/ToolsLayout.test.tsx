/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolsPage } from "./ToolsPage";

const LEGACY_SPACING = /-ui-(?:xxs|xs|sm|md|lg|xl|2xl|3xl)\b/;
const TOOLS_DIR = fileURLToPath(new URL(".", import.meta.url));

function productionTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionTsx(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("工具集布局（UIB-4f）", () => {
  it("使用 PageShell 的 strip 布局，且不再有第二个舱头", () => {
    const html = renderToStaticMarkup(<ToolsPage />);

    expect(html).toContain("page-shell__layout--strip");
    expect(html).not.toContain("page-shell__layout--board");
    expect(html).not.toContain("page-shell__header");
  });

  it("页面内没有 h1，舱头只由 AppShell 工具栏承担", () => {
    expect(renderToStaticMarkup(<ToolsPage />)).not.toMatch(/<h1[\s>]/);
  });

  it("工具目录的生产代码不再使用旧间距令牌名", () => {
    const offenders = productionTsx(TOOLS_DIR).filter((file) =>
      LEGACY_SPACING.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("工具切换标签全部带 slide-item，选中项的 aria-selected 唯一", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    const tabs = Array.from(html.matchAll(/<button[^>]*role="tab"[^>]*>/g), (match) => match[0]);

    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      expect(tab).toContain("slide-item");
    }
    expect(tabs.filter((tab) => tab.includes('aria-selected="true"'))).toHaveLength(1);
  });
});
