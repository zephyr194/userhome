/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardCell, PageShell } from "./PageShell";
import { PageShell as PageShellFromIndex } from "./index";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8");

function pageShellBlock(): string {
  const start = css.indexOf("/* PageShell */");
  const end = css.indexOf("/* /PageShell */");
  if (start < 0 || end < start) throw new Error("missing PageShell block");
  return css.slice(start, end);
}

function tokenValue(name: string): string {
  const match = pageShellBlock().match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function bodiesFor(block: string, selector: string): string[] {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1]
        .split(",")
        .map((part) => part.trim().replace(/\s+/g, " "))
        .includes(selector),
    )
    .map((match) => match[2]);
}

function containerBody(block: string, condition: string): string {
  const start = block.indexOf(`@container ${condition}`);
  if (start < 0) throw new Error(`missing @container ${condition}`);
  const open = block.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < block.length; index += 1) {
    if (block[index] === "{") depth += 1;
    if (block[index] === "}") {
      depth -= 1;
      if (depth === 0) return block.slice(open + 1, index);
    }
  }
  throw new Error(`unclosed @container ${condition}`);
}

describe("PageShell 舱头", () => {
  it("从左到右依次为标题、状态与操作区", () => {
    const markup = renderToStaticMarkup(
      <PageShell
        title="Caddy"
        status={{ tone: "success", text: "运行中" }}
        actions={<button type="button">刷新</button>}
        layout="board"
      >
        <BoardCell span={12}>内容</BoardCell>
      </PageShell>,
    );
    expect(markup).toContain("<h1");
    expect(markup).toContain("Caddy");
    expect(markup).toContain("运行中");
    expect(markup).toContain("刷新");
    const order = ["Caddy", "运行中", "刷新"].map((text) => markup.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("未传入的插槽不渲染对应容器", () => {
    const markup = renderToStaticMarkup(<PageShell title="服务" layout="strip" />);
    expect(markup).toContain("服务");
    expect(markup).not.toContain("page-shell__status");
    expect(markup).not.toContain("page-shell__actions");
  });

  it("状态点只做装饰，文字承载含义，并带上对应语气类", () => {
    const markup = renderToStaticMarkup(
      <PageShell title="AI 工具" status={{ tone: "warning", text: "需要关注" }} layout="strip" />,
    );
    expect(markup).toContain("page-shell__status-dot--warning");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("需要关注");
  });

  it("没有任何舱头插槽时只渲染舱体，不输出 header 与 h1", () => {
    const markup = renderToStaticMarkup(
      <PageShell layout="board">
        <BoardCell span={12}>内容</BoardCell>
      </PageShell>,
    );
    expect(markup).not.toContain("page-shell__header");
    expect(markup).not.toContain("<h1");
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).toContain("内容");
  });

  it("只传状态与操作时渲染舱头，但不输出 h1（页面标题由外层工具栏承担）", () => {
    const markup = renderToStaticMarkup(
      <PageShell
        status={{ tone: "success", text: "当前状态稳定" }}
        actions={<button type="button">重新扫描</button>}
        layout="board"
      />,
    );
    expect(markup).toContain("page-shell__header");
    expect(markup).not.toContain("<h1");
    expect(markup).toContain("当前状态稳定");
    expect(markup).toContain("重新扫描");
  });

  it("ui 索引导出 PageShell", () => {
    expect(PageShellFromIndex).toBe(PageShell);
  });
});

describe("PageShell 舱体布局", () => {
  it("strip、board、master-detail 三种布局各自带上类名", () => {
    const strip = renderToStaticMarkup(<PageShell title="环境" layout="strip" />);
    const board = renderToStaticMarkup(<PageShell title="概览" layout="board" />);
    const detail = renderToStaticMarkup(<PageShell title="设置" layout="master-detail" />);
    expect(strip).toContain("page-shell__layout--strip");
    expect(board).toContain("page-shell__layout--board");
    expect(detail).toContain("page-shell__layout--master-detail");
    expect(strip).not.toContain("page-shell__layout--board");
    expect(board).not.toContain("page-shell__layout--strip");
  });

  it("BoardCell 按 span 输出 4、6、8、12 栅格跨度类", () => {
    for (const span of [4, 6, 8, 12] as const) {
      const markup = renderToStaticMarkup(<BoardCell span={span}>舱位</BoardCell>);
      expect(markup, `span ${span}`).toContain(`page-shell__cell--span-${span}`);
      expect(markup).toContain("舱位");
    }
  });
});

describe("PageShell 样式令牌与布局规则", () => {
  it("新块位于 global.css 中且不使用 !important、clip-path 或负 z-index", () => {
    const block = pageShellBlock();
    expect(block).not.toContain("!important");
    expect(block).not.toContain("clip-path");
    expect(block).not.toMatch(/z-index:\s*-/);
  });

  it("舱头最小高度取 toolbar 令牌并带下沿发丝线", () => {
    const header = bodiesFor(pageShellBlock(), ".page-shell__header").join("\n");
    expect(header).toMatch(/min-height:\s*var\(--app-toolbar-height\)/);
    expect(header).toMatch(/border-bottom:\s*1px solid var\(--app-line-subtle\)/);
  });

  it("舱体是 inline-size 容器，且子元素允许收缩", () => {
    const block = pageShellBlock();
    expect(bodiesFor(block, ".page-shell__body").join("\n")).toMatch(
      /container-type:\s*inline-size/,
    );
    expect(bodiesFor(block, ".page-shell__layout > *").join("\n")).toMatch(/min-width:\s*0/);
  });

  it("board 为 12 栏网格，BoardCell 跨度与 span 类一一对应", () => {
    const block = pageShellBlock();
    expect(bodiesFor(block, ".page-shell__layout--board").join("\n")).toMatch(
      /grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/,
    );
    for (const span of [4, 6, 8, 12]) {
      expect(bodiesFor(block, `.page-shell__cell--span-${span}`).join("\n")).toMatch(
        new RegExp(`grid-column:\\s*span ${span}\\s*/\\s*span ${span}`),
      );
    }
  });

  it("board 在内容区宽度 <960px 时降级为单列且跨度占满", () => {
    const body = containerBody(pageShellBlock(), "(max-width: 959.98px)");
    expect(bodiesFor(body, ".page-shell__layout--board").join("\n")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(bodiesFor(body, ".page-shell__layout--board > .page-shell__cell").join("\n")).toMatch(
      /grid-column:\s*1\s*\/\s*-1/,
    );
  });

  it("master-detail 列表固定 280px 令牌，详情占 1fr", () => {
    const block = pageShellBlock();
    expect(tokenValue("app-page-master-width")).toBe("280px");
    expect(bodiesFor(block, ".page-shell__layout--master-detail").join("\n")).toMatch(
      /grid-template-columns:\s*var\(--app-page-master-width\)\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("master-detail 在内容区宽度 <760px 时堆叠为单列", () => {
    const body = containerBody(pageShellBlock(), "(max-width: 759.98px)");
    expect(bodiesFor(body, ".page-shell__layout--master-detail").join("\n")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("间距全部取自新 4px 栅格令牌", () => {
    const block = pageShellBlock();
    expect(bodiesFor(block, ".page-shell__layout--strip").join("\n")).toMatch(
      /gap:\s*var\(--app-space-12\)/,
    );
    expect(bodiesFor(block, ".page-shell__layout--board").join("\n")).toMatch(
      /gap:\s*var\(--app-space-16\)/,
    );
    expect(bodiesFor(block, ".page-shell__layout").join("\n")).toMatch(
      /padding:\s*var\(--app-space-16\)/,
    );
  });

  it("除 1px 发丝线外，块内不出现字面像素值（令牌定义与容器条件除外）", () => {
    const body = pageShellBlock()
      .replace(/--app-[\w-]+:\s*[^;]+;/g, "")
      .replace(/@container[^{]*\{/g, "{");
    const literals = body.match(/-?\d*\.?\d+px/g) ?? [];
    expect(literals.filter((value) => value !== "1px")).toEqual([]);
  });
});
