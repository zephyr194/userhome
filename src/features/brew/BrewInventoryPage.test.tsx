import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decodeBrewPackagePage } from "../../ipc/brew";
import { BrewInventoryList } from "./BrewInventoryList";
import { BrewInventoryPage } from "./BrewInventoryPage";

const READY_SUMMARY = {
  status: "READY" as const,
  data: {
    available: true,
    prefix: "/opt/homebrew",
    version: "Homebrew 4.6.0",
    formulaCount: 134,
    caskCount: 40,
  },
};

function readyPage() {
  return decodeBrewPackagePage({
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
}

describe("BrewInventoryPage", () => {
  it("renders a non-blocking inventory loading state and summary counts", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryPage refreshId="refresh-1" summary={READY_SUMMARY} />,
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

  it("renders one workbench without a duplicate page hero or main title", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryPage refreshId="refresh-1" summary={READY_SUMMARY} />,
    );

    expect(markup).toContain("brew-workspace");
    expect(markup).not.toMatch(/<h1[\s>]/);
    expect(markup).not.toMatch(/<h2[\s>]/);
    expect(markup).not.toContain('id="brew-heading"');
    expect(markup).not.toContain("section-kicker");
  });

  it("keeps the selected detail pane mounted independently of the list state", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryPage
        initialSelection={{ kind: "FORMULA", identifier: "caddy" }}
        refreshId="refresh-1"
        summary={READY_SUMMARY}
      />,
    );

    expect(markup).toContain("brew-workspace__detail");
    expect(markup).toContain("正在加载详情…");
    expect(markup).not.toContain("选择一个已安装软件包以查看详情");
  });
});

describe("BrewInventoryList", () => {
  it("renders the inventory list, a pane heading and a fixed pagination footer", () => {
    const markup = renderToStaticMarkup(
      <BrewInventoryList
        state={{ status: "ready", page: readyPage() }}
        onPageChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("brew-workspace__list");
    expect(markup).toContain("brew-workspace__pane-heading");
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
    expect(markup.match(/tabindex="0"/g) ?? []).toHaveLength(1);
    expect(markup).toContain("2 项");
    expect(markup).toContain("brew-workspace__pagination");
    // The pagination footer follows (and is not part of) the scrollable list.
    expect(markup.indexOf("</ul>")).toBeLessThan(
      markup.indexOf("brew-workspace__pagination"),
    );
  });

  it("wraps long names, descriptions and versions instead of truncating them", () => {
    const longName = "a-very-long-formula-name-for-wrapping-".repeat(6);
    const longVersion = "2026.10.10-beta.build.".repeat(6);
    const page = decodeBrewPackagePage({
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
      items: [
        {
          kind: "FORMULA",
          identifier: longName,
          displayName: longName,
          description: longName,
          installedVersions: [longVersion],
          outdated: false,
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <BrewInventoryList
        state={{ status: "ready", page }}
        onPageChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain(longName);
    expect(markup).toContain(longVersion);
    expect(markup).not.toContain("truncate");
    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).toContain("break-all");
  });
});
