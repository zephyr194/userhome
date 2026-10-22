/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardViewContext, type BoardViewContextValue } from "../../app/BoardViewContext";
import { CaddyPage } from "./CaddyPage";

const CADDY_DIR = fileURLToPath(new URL("./", import.meta.url));
const OLD_SPACING_TOKEN =
  /(?<![\w-])(?:gap|gap-x|gap-y|space-x|space-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-ui-(?:xxs|xs|sm|md|lg|xl|2xl|3xl)(?![\w-])/;

function noop() {}

function boardValue(isBoard: boolean): BoardViewContextValue {
  return { available: true, view: isBoard ? "board" : "compact", isBoard, enter: noop, exit: noop, toggle: noop };
}

function renderCaddy(isBoard: boolean): string {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={boardValue(isBoard)}>
      <CaddyPage />
    </BoardViewContext.Provider>,
  );
}

const VISIBLE_BLOCKS = [
  "Caddy 检测",
  "运行（自有实例）",
  "Caddy 日志",
  "表单规则",
  "原文 Caddyfile",
  "正在读取已保存的规则",
];

describe("Caddy 页布局（UIB-4c）", () => {
  it("紧凑视图使用 strip 布局，无舱头与 h1", () => {
    const markup = renderCaddy(false);
    expect(markup).toContain("page-shell__layout--strip");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__header");
    expect(markup).not.toContain("<h1");
  });

  it("看板视图使用 board 布局，运行列与规则列为 4/8 跨度", () => {
    const markup = renderCaddy(true);
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__layout--strip");
    expect(markup).toContain("page-shell__cell--span-4");
    expect(markup).toContain("page-shell__cell--span-8");
    expect(markup).not.toContain("<h1");
  });

  it("紧凑与看板视图的可见区块一致，仅布局不同", () => {
    const compact = renderCaddy(false);
    const board = renderCaddy(true);
    for (const block of VISIBLE_BLOCKS) {
      expect(compact, `compact: ${block}`).toContain(block);
      expect(board, `board: ${block}`).toContain(block);
    }
  });

  it("预览与原文编辑器在表单/原文切换中以 hidden 保持挂载", () => {
    const markup = renderCaddy(false);
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
