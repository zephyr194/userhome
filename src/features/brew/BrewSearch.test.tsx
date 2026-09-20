import { mockIPC } from "@tauri-apps/api/mocks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getBrewPackage,
  searchBrewPackages,
} from "../../ipc/brew";
import { BrewSearch } from "./BrewSearch";

describe("BrewSearch", () => {
  it("renders a bounded search control", () => {
    const markup = renderToStaticMarkup(<BrewSearch onChanged={() => {}} />);
    expect(markup).toContain("Homebrew 搜索");
    expect(markup).toContain('maxLength="128"');
    expect(markup).toContain('type="search"');
  });

  it("uses typed search and details contracts in a mocked flow", async () => {
    mockIPC((command, payload) => {
      if (command === "search_brew_packages") {
        expect(payload).toEqual({
          query: { query: "caddy", page: 1, pageSize: 25 },
        });
        return {
          page: 1,
          pageSize: 25,
          totalItems: 1,
          totalPages: 1,
          items: [{ kind: "FORMULA", identifier: "caddy" }],
        };
      }
      expect(command).toBe("get_brew_package");
      return {
        kind: "FORMULA",
        identifier: "caddy",
        displayName: "caddy",
        description: "Web server",
        homepage: "https://caddyserver.com",
        currentVersion: "2.11.4",
        installedVersions: [],
        outdated: false,
      };
    });

    await expect(
      searchBrewPackages({ query: "caddy", page: 1, pageSize: 25 }),
    ).resolves.toMatchObject({ totalItems: 1 });
    await expect(getBrewPackage("FORMULA", "caddy")).resolves.toMatchObject({
      currentVersion: "2.11.4",
    });
  });
});
