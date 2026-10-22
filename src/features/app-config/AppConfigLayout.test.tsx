import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppConfigListItem } from "../../ipc/appConfig";
import type { DetailState, ListState } from "./appConfigModel";
import { AppConfigView } from "./AppConfigView";

const noop = () => undefined;

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

function renderView(detail: DetailState = { status: "idle" }): string {
  return renderToStaticMarkup(
    <AppConfigView detail={detail} list={READY} onReload={noop} onSelect={noop} />,
  );
}

describe("app config page layout (UIB-4e)", () => {
  it("uses the master-detail layout", () => {
    const markup = renderView();
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("条目");
    expect(markup).toContain('aria-labelledby="app-config-detail-title"');
  });

  it("marks the selected entry with the slide selection language and aria-current only", () => {
    const buttons = renderView(SELECTED).match(/<button[^>]*>/g) ?? [];
    const current = buttons.filter((tag) => tag.includes('aria-current="true"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toMatch(/class="[^"]*\bslide-item\b/);
    expect(current[0]).not.toMatch(/border-primary|bg-selection/);
  });

  it("leaves the page heading to the app shell", () => {
    expect(renderView()).not.toContain("<h1");
  });
});
