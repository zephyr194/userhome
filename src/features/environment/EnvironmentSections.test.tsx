import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionContext } from "../../app/SectionContext";
import { EnvironmentPage } from "./EnvironmentPage";

const noop = () => undefined;

function render(section?: string): string {
  return renderToStaticMarkup(
    <SectionContext.Provider value={section === undefined ? undefined : { section, select: noop }}>
      <EnvironmentPage />
    </SectionContext.Provider>,
  );
}

function selectedDomain(markup: string): string | undefined {
  const tags = markup.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
  const selected = tags.find((tag) => tag.includes('aria-selected="true"'));
  return selected?.match(/data-section-id="([^"]+)"/)?.[1];
}

describe("environment page sections", () => {
  it("selects the zsh domain for the zsh section", () => {
    expect(selectedDomain(render("zsh"))).toBe("zsh");
  });

  it("selects the dotenv domain without a section or for the dotenv section", () => {
    for (const markup of [render(), render("dotenv")]) {
      expect(selectedDomain(markup)).toBe("dotenv");
    }
  });

  it("selects the login session domain for the launchctl section", () => {
    expect(selectedDomain(render("launchctl"))).toBe("launchctl");
  });
});
