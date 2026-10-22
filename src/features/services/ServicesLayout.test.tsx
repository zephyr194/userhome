import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleDiscovery } from "./launchdFixtures";
import { EMPTY_FILTER, type DiscoveryState } from "./launchdModel";
import { ServicesView } from "./ServicesView";

const noop = () => undefined;

function renderView(): string {
  const state: DiscoveryState = {
    status: "ready",
    discovery: sampleDiscovery(),
    refreshing: false,
  };
  return renderToStaticMarkup(
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
    />,
  );
}

describe("services page layout (UIB-4b)", () => {
  it("uses the master-detail layout", () => {
    const markup = renderView();
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("服务清单");
    expect(markup).toContain('aria-label="任务详情"');
    expect(markup).toContain("管理占位");
    expect(markup).toContain("日志占位");
  });

  it("leaves the page heading to the app shell", () => {
    expect(renderView()).not.toContain("<h1");
  });

  it("marks every selectable service row with the slide selection language", () => {
    const markup = renderView();
    expect(markup.match(/class="[^"]*\bslide-item\b[^"]*services-inventory-row/g)).toHaveLength(6);
  });
});
