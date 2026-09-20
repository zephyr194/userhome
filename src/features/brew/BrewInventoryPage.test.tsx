import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decodeBrewPackagePage } from "../../ipc/brew";
import { BrewInventoryPage } from "./BrewInventoryPage";

describe("BrewInventoryPage", () => {
  it("renders a non-blocking inventory loading state and summary counts", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryPage
        refreshId="refresh-1"
        summary={{
          status: "READY",
          data: {
            available: true,
            prefix: "/opt/homebrew",
            version: "Homebrew 4.6.0",
            formulaCount: 134,
            caskCount: 40,
          },
        }}
      />,
    );

    expect(markup).toContain("Formula 134");
    expect(markup).toContain("Cask 40");
    expect(markup).toContain("/opt/homebrew");
    expect(markup).toContain('aria-busy="true"');
  });

  it("decodes formula and cask pages as distinct typed results", () => {
    const page = decodeBrewPackagePage({
      page: 1,
      pageSize: 25,
      totalItems: 2,
      totalPages: 1,
      items: [
        {
          kind: "FORMULA",
          identifier: "git",
          displayName: "git",
          description: "Version control",
          installedVersions: ["2.51.0"],
          outdated: false,
        },
        {
          kind: "CASK",
          identifier: "visual-studio-code",
          displayName: "Visual Studio Code",
          installedVersions: ["1.99.0"],
          outdated: true,
        },
      ],
    });

    expect(page.items.map((item) => item.kind)).toEqual(["FORMULA", "CASK"]);
  });

  it("renders missing Homebrew as a usable empty state", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryPage
        summary={{
          status: "READY",
          data: {
            available: false,
            formulaCount: 0,
            caskCount: 0,
          },
        }}
      />,
    );

    expect(markup).toContain("/opt/homebrew");
    expect(markup).toContain("/usr/local");
    expect(markup).not.toContain('role="alert"');
  });
});
