import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvironmentPage } from "./EnvironmentPage";

function renderPage(): string {
  return renderToStaticMarkup(<EnvironmentPage />);
}

function panelTags(markup: string): string[] {
  return markup.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
}

describe("environment page layout (UIB-4e)", () => {
  it("uses the strip layout in the compact view with the tab row as its first row", () => {
    const markup = renderPage();
    expect(markup).toContain("page-shell__layout--strip");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup.indexOf('role="tablist"')).toBeLessThan(markup.indexOf("环境文件"));
  });

  it("shows the dotenv section and keeps the zsh section mounted but hidden", () => {
    const [dotenv, zsh] = panelTags(renderPage());
    expect(dotenv).not.toContain("hidden");
    expect(zsh).toContain("hidden");
  });

  it("leaves the page heading to the app shell", () => {
    expect(renderPage()).not.toContain("<h1");
  });

  it("marks the selected tab with the slide selection language and aria-selected", () => {
    const tabs = renderPage().match(/<button[^>]*role="tab"[^>]*>|<button[^>]*>[^<]*<\/button>/g) ?? [];
    const selected = (tabs.filter((tag) => tag.includes('aria-selected="true"')));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatch(/class="[^"]*\bslide-item\b/);
  });
});
