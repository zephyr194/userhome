/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaddyPage } from "./CaddyPage";

const CADDY_DIR = fileURLToPath(new URL("./", import.meta.url));
const OLD_SPACING_TOKEN =
  /(?<![\w-])(?:gap|gap-x|gap-y|space-x|space-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-ui-(?:xxs|xs|sm|md|lg|xl|2xl|3xl)(?![\w-])/;

function renderCaddy(): string {
  return renderToStaticMarkup(<CaddyPage />);
}

describe("Caddy 页布局（UIB-4c）", () => {
  it("使用 strip 布局，无舱头与 h1", () => {
    const markup = renderCaddy();
    expect(markup).toContain("page-shell__layout--strip");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__header");
    expect(markup).not.toContain("<h1");
  });

  it("预览与原文编辑器在表单/原文切换中以 hidden 保持挂载", () => {
    const markup = renderCaddy();
    expect(markup).toContain('aria-labelledby="raw-editor-heading"');
    expect(markup).toMatch(/<section[^>]*hidden=""/);
  });

  it("Caddy 生产文件不再使用旧间距令牌名", () => {
    const offenders = readdirSync(CADDY_DIR)
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .filter((name) => OLD_SPACING_TOKEN.test(readFileSync(join(CADDY_DIR, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
