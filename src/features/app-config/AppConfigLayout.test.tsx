import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BoardViewContext,
  type BoardViewContextValue,
} from "../../app/BoardViewContext";
import type { AppConfigListItem } from "../../ipc/appConfig";
import type { DetailState, ListState } from "./appConfigModel";
import { AppConfigView } from "./AppConfigView";

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

function item(id: string, category: AppConfigListItem["summary"]["category"]): AppConfigListItem {
  return {
    summary: {
      id,
      name: `名称 ${id}`,
      category,
      displayPath: `~/.config/${id}.json`,
      format: "json",
      capability: "readOnly",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
    },
    probe: { status: "found", size: 120, modifiedUnixMillis: 1_700_000_000_000 },
  };
}

const ITEMS: AppConfigListItem[] = [item("zed-settings", "editor"), item("tmux-conf", "terminal")];
const READY: ListState = { status: "ready", items: ITEMS };
const SELECTED: DetailState = { status: "loading", requestId: 1, id: "zed-settings" };

function renderView(context: BoardViewContextValue, detail: DetailState = { status: "idle" }): string {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={context}>
      <AppConfigView detail={detail} list={READY} onReload={noop} onSelect={noop} />
    </BoardViewContext.Provider>,
  );
}

function withoutClasses(markup: string): string {
  return markup.replace(/ class="[^"]*"/g, "");
}

describe("app config page layout (UIB-4e)", () => {
  it("uses the master-detail layout in the compact view", () => {
    const markup = renderView(COMPACT);
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("条目");
    expect(markup).toContain('aria-labelledby="app-config-detail-title"');
  });

  it("uses the board layout with a 4 list and 8 detail span and keeps every block visible", () => {
    const markup = renderView(BOARD);
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__layout--master-detail");
    expect(markup).toContain("page-shell__cell--span-4");
    expect(markup).toContain("page-shell__cell--span-8");
    expect(markup).toContain("条目");
    expect(markup).toContain('aria-labelledby="app-config-detail-title"');
  });

  it("renders the same element tree in both views so switching never remounts", () => {
    expect(withoutClasses(renderView(BOARD, SELECTED))).toBe(
      withoutClasses(renderView(COMPACT, SELECTED)),
    );
  });

  it("marks the selected entry with the bracket language and aria-current only", () => {
    const buttons = renderView(COMPACT, SELECTED).match(/<button[^>]*>/g) ?? [];
    const current = buttons.filter((tag) => tag.includes('aria-current="true"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toMatch(/class="[^"]*\bbracket\b/);
    expect(current[0]).not.toMatch(/border-primary|bg-selection/);
  });

  it("leaves the page heading to the app shell", () => {
    for (const markup of [renderView(COMPACT), renderView(BOARD)]) {
      expect(markup).not.toContain("<h1");
    }
  });
});
