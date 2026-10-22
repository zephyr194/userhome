import { describe, expect, it } from "vitest";
import { APP_ROUTES, activeSectionOf, groupNavigationRoutes, routeSectionsOf, type AppRouteId } from "./routeDefinitions";

function routeOf(id: AppRouteId) {
  const route = APP_ROUTES.find((entry) => entry.id === id);
  if (!route) throw new Error(`missing route ${id}`);
  return route;
}

describe("route sections", () => {
  it("declares sections only on the environment and Caddy pages", () => {
    expect(APP_ROUTES.filter((route) => route.sections).map((route) => route.id)).toEqual([
      "environment",
      "caddy",
    ]);
  });

  it("hardcodes the Caddy sections in display order", () => {
    expect(routeOf("caddy").sections).toEqual([
      { id: "rules", label: "站点规则" },
      { id: "run", label: "运行" },
      { id: "raw", label: "原文 Caddyfile" },
    ]);
  });

  it("gives the AI tools page no sections, since the tool list selects the tool", () => {
    expect(routeOf("aiConfig").sections).toBeUndefined();
    expect(routeSectionsOf("aiConfig")).toEqual([]);
  });

  it("hardcodes the environment sections to match its existing tabs", () => {
    expect(routeOf("environment").sections).toEqual([
      { id: "dotenv", label: "dotenv 文件" },
      { id: "zsh", label: "zsh 启动文件" },
    ]);
  });

  it("keeps eight primary navigation entries", () => {
    const entries = groupNavigationRoutes(APP_ROUTES).flatMap((entry) => entry.routes);
    expect(entries).toHaveLength(8);
  });

  it("uses the stored section when the route declares it and the first section otherwise", () => {
    const caddy = routeOf("caddy");
    expect(activeSectionOf(caddy, "raw")?.id).toBe("raw");
    expect(activeSectionOf(caddy, undefined)?.id).toBe("rules");
    expect(activeSectionOf(caddy, "retired")?.id).toBe("rules");
    expect(activeSectionOf(routeOf("dashboard"), "rules")).toBeUndefined();
  });

  it("returns the declared sections per route and none for a route without them", () => {
    expect(routeSectionsOf("caddy")).toEqual(routeOf("caddy").sections);
    expect(routeSectionsOf("dashboard")).toEqual([]);
  });
});
