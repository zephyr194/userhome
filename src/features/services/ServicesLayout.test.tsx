import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BoardViewContext,
  type BoardViewContextValue,
} from "../../app/BoardViewContext";
import { sampleDiscovery } from "./launchdFixtures";
import { EMPTY_FILTER, type DiscoveryState } from "./launchdModel";
import { ServicesView } from "./ServicesView";

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

function renderView(context: BoardViewContextValue): string {
  const state: DiscoveryState = {
    status: "ready",
    discovery: sampleDiscovery(),
    refreshing: false,
  };
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={context}>
      <ServicesView
        state={state}
        evidence={{ status: "ready", summaries: [] }}
        filter={EMPTY_FILTER}
        selectedId="gui/501/com.example.idle"
        refreshDisabled={false}
        onFilterChange={noop}
        onSelect={noop}
        onRefresh={noop}
        renderManagement={() => <p>管理占位</p>}
        renderLogs={() => <p>日志占位</p>}
      />
    </BoardViewContext.Provider>,
  );
}

function withoutClasses(markup: string): string {
  return markup.replace(/ class="[^"]*"/g, "");
}

describe("services page layout (UIB-4b)", () => {
  it("uses the master-detail layout in the compact view", () => {
    const markup = renderView(COMPACT);
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("服务清单");
    expect(markup).toContain('aria-label="任务详情"');
    expect(markup).toContain("管理占位");
    expect(markup).toContain("日志占位");
  });

  it("uses the board layout with a 4 and 8 span and keeps every block visible", () => {
    const markup = renderView(BOARD);
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__layout--master-detail");
    expect(markup).toContain("page-shell__cell--span-4");
    expect(markup).toContain("page-shell__cell--span-8");
    expect(markup).toContain("服务清单");
    expect(markup).toContain('aria-label="任务详情"');
    expect(markup).toContain("管理占位");
    expect(markup).toContain("日志占位");
  });

  it("renders the same element tree in both views so switching never remounts", () => {
    expect(withoutClasses(renderView(BOARD))).toBe(
      withoutClasses(renderView(COMPACT)),
    );
  });

  it("leaves the page heading to the app shell", () => {
    for (const markup of [renderView(COMPACT), renderView(BOARD)]) {
      expect(markup).not.toContain("<h1");
    }
  });

  it("marks every selectable service row with the slide selection language", () => {
    const markup = renderView(COMPACT);
    expect(markup.match(/class="[^"]*\bslide-item\b[^"]*services-inventory-row/g)).toHaveLength(6);
  });
});
