import { describe, expect, it } from "vitest";
import { APP_ROUTES, NAV_GROUPS, groupNavigationRoutes } from "./routeDefinitions";

describe("route registry", () => {
  it("registers every route id exactly once", () => {
    const ids = APP_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["dashboard", "services", "settings"]),
    );
  });

  it("declares the tool groups and the support group in display order", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      "系统工具",
      "工具集",
      "支撑",
    ]);
  });

  it("keeps overview, services and settings as support entries", () => {
    const support = groupNavigationRoutes(APP_ROUTES).find(
      (entry) => entry.group.id === "support",
    );
    expect(support?.routes.map((route) => route.id)).toEqual([
      "dashboard",
      "services",
      "settings",
    ]);
  });

  it("keeps the applications and homebrew routes registered but out of the primary navigation", () => {
    const registered = APP_ROUTES.map((route) => route.id);
    expect(registered).toContain("applications");
    expect(registered).toContain("homebrew");

    const navigable = groupNavigationRoutes(APP_ROUTES).flatMap((entry) =>
      entry.routes.map((route) => route.id),
    );
    expect(navigable).not.toContain("applications");
    expect(navigable).not.toContain("homebrew");
  });

  it("returns every declared group even when it has no routes yet", () => {
    const grouped = groupNavigationRoutes(APP_ROUTES);
    expect(grouped.map((entry) => entry.group.id)).toEqual(
      NAV_GROUPS.map((group) => group.id),
    );
  });

  it("lists environment variables first and Caddy after under system tools", () => {
    const tools = groupNavigationRoutes(APP_ROUTES).find(
      (entry) => entry.group.id === "system-tools",
    );
    expect(tools?.routes.map((route) => route.label)).toEqual(["环境变量", "Caddy"]);
  });

  it("describes the services page as launchd discovery, not Homebrew-only management", () => {
    const services = APP_ROUTES.find((route) => route.id === "services");
    expect(services?.description).toBe(
      "发现并查看本机常驻任务（launchd），管理自建任务。",
    );
    expect(services?.description).not.toContain("Homebrew");
  });

  it("places the tools page alone in the toolset group", () => {
    const toolset = groupNavigationRoutes(APP_ROUTES).find(
      (entry) => entry.group.id === "toolset",
    );
    expect(toolset?.routes.map((route) => route.id)).toEqual(["tools"]);
    expect(toolset?.routes[0]?.label).toBe("工具集");
  });
});
