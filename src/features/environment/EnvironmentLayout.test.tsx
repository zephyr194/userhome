import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvironmentPage } from "./EnvironmentPage";

function renderPage(): string {
  return renderToStaticMarkup(<EnvironmentPage />);
}

function hiddenPanels(markup: string): string[] {
  return markup.match(/<div[^>]*hidden=""[^>]*>/g) ?? [];
}

describe("environment page layout (UIB-4e)", () => {
  it("uses the master-detail layout with the domain menu before the content", () => {
    const markup = renderPage();
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--strip");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup.indexOf('aria-label="环境变量域"')).toBeLessThan(markup.indexOf("环境文件"));
  });

  it("shows the dotenv domain and keeps the zsh and login session domains mounted but hidden", () => {
    const hidden = hiddenPanels(renderPage());
    expect(hidden).toHaveLength(2);
  });

  it("leaves the page heading to the app shell", () => {
    expect(renderPage()).not.toContain("<h1");
  });

  it("marks the selected domain with the slide selection language and aria-selected", () => {
    const tabs = renderPage().match(/<button[^>]*role="tab"[^>]*>|<button[^>]*>[^<]*<\/button>/g) ?? [];
    const selected = (tabs.filter((tag) => tag.includes('aria-selected="true"')));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatch(/class="[^"]*\bslide-item\b/);
  });
});
