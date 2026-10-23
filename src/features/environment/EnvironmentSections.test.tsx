import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../../app/deepLink";
import { SectionContext } from "../../app/SectionContext";
import { routeSectionsOf } from "../../app/routeDefinitions";
import { EnvironmentPage } from "./EnvironmentPage";

const noop = () => undefined;

function render(section?: string): string {
  return renderToStaticMarkup(
    <SectionContext.Provider value={section === undefined ? undefined : { section, select: noop }}>
      <EnvironmentPage />
    </SectionContext.Provider>,
  );
}

function selectedTabs(markup: string): Array<string | undefined> {
  const tags = markup.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
  return tags
    .filter((tag) => tag.includes('aria-selected="true"'))
    .map((tag) => tag.match(/data-section-id="([^"]+)"/)?.[1]);
}

describe("environment page sections", () => {
  it("selects the system domain and the zsh tab for the zsh section", () => {
    expect(selectedTabs(render("zsh"))).toEqual(["system", "zsh"]);
  });

  it("selects the dotenv domain without a section or for the dotenv section", () => {
    for (const markup of [render(), render("dotenv")]) {
      expect(selectedTabs(markup)).toEqual(["dotenv"]);
    }
  });

  it("selects the system domain and the login session tab for the launchctl section", () => {
    expect(selectedTabs(render("launchctl"))).toEqual(["system", "launchctl"]);
  });
});

describe("environment route sections stay as they were", () => {
  it("declares the same three section values for the environment route", () => {
    expect(routeSectionsOf("environment").map((section) => section.id)).toEqual([
      "dotenv",
      "zsh",
      "launchctl",
    ]);
  });

  it("accepts each section value in a deep link", () => {
    for (const section of ["dotenv", "zsh", "launchctl"]) {
      expect(parseDeepLink(`userhome://open/environment?section=${section}`)).toMatchObject({
        routeId: "environment",
        section,
      });
    }
  });
});
