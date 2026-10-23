import { describe, expect, it } from "vitest";
import { APP_ROUTES, activeSectionOf, primaryNavigationRoutes, routeSectionsOf, type AppRouteId } from "./routeDefinitions";

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

  it("declares the Caddy sections in display order", () => {
    expect(routeOf("caddy").sections).toEqual([
      { id: "rules", labelKey: "route.section.rules" },
      { id: "run", labelKey: "route.section.run" },
      { id: "raw", labelKey: "route.section.raw" },
    ]);
  });

  it("gives the AI tools page no sections, since the tool list selects the tool", () => {
    expect(routeOf("aiConfig").sections).toBeUndefined();
    expect(routeSectionsOf("aiConfig")).toEqual([]);
  });

  it("declares the environment sections to match its domain menu", () => {
    expect(routeOf("environment").sections).toEqual([
      { id: "dotenv", labelKey: "route.section.dotenv" },
      { id: "zsh", labelKey: "route.section.zsh" },
      { id: "launchctl", labelKey: "route.section.launchctl" },
    ]);
  });

  it("keeps eight primary navigation entries", () => {
    expect(primaryNavigationRoutes(APP_ROUTES)).toHaveLength(8);
  });

  it("uses the stored section when the route declares it and the first section otherwise", () => {
    const caddy = routeOf("caddy");
    expect(activeSectionOf(caddy, "raw")?.id).toBe("raw");
    expect(activeSectionOf(caddy, undefined)?.id).toBe("rules");
    expect(activeSectionOf(caddy, "retired")?.id).toBe("rules");
    expect(activeSectionOf(routeOf("dashboard"), "rules")).toBeUndefined();
  });

  it("returns the declared sections per route with zh-CN labels by default", () => {
    expect(routeSectionsOf("caddy")).toEqual([
      { id: "rules", label: "站点规则" },
      { id: "run", label: "运行" },
      { id: "raw", label: "原文 Caddyfile" },
    ]);
    expect(routeSectionsOf("dashboard")).toEqual([]);
  });
});
