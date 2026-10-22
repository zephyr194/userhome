import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BoardViewContext,
  type BoardViewContextValue,
} from "../../app/BoardViewContext";
import { EnvironmentPage } from "./EnvironmentPage";

const noop = () => undefined;

const COMPACT: BoardViewContextValue = {
  available: true,
  view: "compact",
  isBoard: false,
  enter: noop,
  exit: noop,
  toggle: noop,
};
const BOARD: BoardViewContextValue = {
  ...COMPACT,
  view: "board",
  isBoard: true,
};

function renderPage(context: BoardViewContextValue): string {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={context}>
      <EnvironmentPage />
    </BoardViewContext.Provider>,
  );
}

function withoutClasses(markup: string): string {
  return markup.replace(/ class="[^"]*"/g, "");
}

function panelTags(markup: string): string[] {
  return markup.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
}

describe("environment page layout (UIB-4e)", () => {
  it("uses the strip layout in the compact view with the tab row as its first row", () => {
    const markup = renderPage(COMPACT);
    expect(markup).toContain("page-shell__layout--strip");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup.indexOf('role="tablist"')).toBeLessThan(markup.indexOf("环境文件"));
  });

  it("uses the board layout with 4 / 8 spans for sources and variables, keeping both visible", () => {
    const markup = renderPage(BOARD);
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__layout--strip");
    expect(markup).toContain("page-shell__cell--span-4");
    expect(markup).toContain("page-shell__cell--span-8");
    expect(markup).toContain("环境文件");
    expect(markup).toContain("文件内容（只读）");
  });

  it("shows the dotenv section and keeps the zsh section mounted but hidden", () => {
    for (const markup of [renderPage(COMPACT), renderPage(BOARD)]) {
      const [dotenv, zsh] = panelTags(markup);
      expect(dotenv).not.toContain("hidden");
      expect(zsh).toContain("hidden");
    }
  });

  it("renders the same element tree in both views so switching never remounts", () => {
    expect(withoutClasses(renderPage(BOARD))).toBe(withoutClasses(renderPage(COMPACT)));
  });

  it("leaves the page heading to the app shell", () => {
    for (const markup of [renderPage(COMPACT), renderPage(BOARD)]) {
      expect(markup).not.toContain("<h1");
    }
  });

  it("marks the selected tab with the slide selection language and aria-selected", () => {
    const tabs = renderPage(COMPACT).match(/<button[^>]*role="tab"[^>]*>|<button[^>]*>[^<]*<\/button>/g) ?? [];
    const selected = (tabs.filter((tag) => tag.includes('aria-selected="true"')));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatch(/class="[^"]*\bslide-item\b/);
  });
});
