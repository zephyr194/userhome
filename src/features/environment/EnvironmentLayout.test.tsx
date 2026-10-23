import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionContext } from "../../app/SectionContext";
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
    expect(markup.indexOf('aria-label="环境变量域"')).toBeLessThan(
      markup.indexOf('class="environment-page__content'),
    );
  });

  it("shows the dotenv domain and keeps the zsh and login session domains mounted but hidden", () => {
    const hidden = hiddenPanels(renderPage());
    expect(hidden).toHaveLength(2);
  });

  it("keeps 8px inside the domain menu column on both sides, away from the divider", () => {
    const menu = renderPage().match(/<div class="([^"]*environment-page__menu[^"]*)"/)?.[1] ?? "";
    expect(menu.split(/\s+/)).toContain("px-ui-8");
  });

  it("draws no outer frame or header band around the domain content", () => {
    const markup = renderPage();
    expect(markup).toMatch(/class="[^"]*\bborderless-pane\b/);
    expect(markup).not.toMatch(/class="[^"]*\bborder-b border-border\b/);
    expect(markup).not.toMatch(/<header class="[^"]*bg-surface-muted/);
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

const css = readFileSync(fileURLToPath(new URL("../../styles/global.css", import.meta.url)), "utf8");

describe("environment page scrolling", () => {
  it("scrolls only the domain content region, not the domain menu or the detail column", () => {
    const markup = renderPage();
    expect(markup).toMatch(/class="environment-page__detail[^"]*"/);
    expect(markup).toMatch(/class="environment-page__content[^"]*"/);
    expect(css).toMatch(/\.environment-page__content\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/\.environment-page__detail\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/\.environment-page__menu\s*\{[^}]*overflow/);
  });

  it("keeps each directory tab at its content width inside the sideways-scrolling tab row", () => {
    expect(css).toMatch(/\.environment-page__tab-scroll\s*\[role="tab"\]\s*\{[^}]*flex:\s*none/);
  });

  it("keeps the system tabs above the scrolling content region", () => {
    const markup = renderToStaticMarkup(
      <SectionContext.Provider value={{ section: "zsh", select: () => undefined }}>
        <EnvironmentPage />
      </SectionContext.Provider>,
    );
    const tabs = markup.indexOf('aria-label="系统环境变量分区"');
    const content = markup.indexOf('class="environment-page__content');
    expect(tabs).toBeGreaterThan(-1);
    expect(tabs).toBeLessThan(content);
    expect(markup.slice(content)).not.toContain('aria-label="系统环境变量分区"');
  });
});
