import { describe, expect, it } from "vitest";
import {
  APP_ROUTES,
  groupNavigationRoutes,
  isRestorableRoute,
  NAV_GROUPS,
  navigationRouteOf,
  primaryNavigationRoutes,
} from "./routeDefinitions";

describe("route registry", () => {
  it("registers every route id exactly once", () => {
    const ids = APP_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["dashboard", "services", "settings", "systemTools"]),
    );
  });

  it("lists the sidebar entries in the fixed order across the groups", () => {
    expect(primaryNavigationRoutes(APP_ROUTES).map((route) => route.label)).toEqual([
      "环境变量",
      "应用配置",
      "AI 工具",
      "系统工具",
      "工具集",
      "概览",
      "服务",
      "设置",
    ]);
  });

  it("puts the sidebar entries under three headed groups in the fixed order", () => {
    expect(NAV_GROUPS.map((group) => [group.id, group.label])).toEqual([
      ["system-tools", "系统工具"],
      ["toolset", "工具集"],
      ["support", "支撑"],
    ]);
    const groups = groupNavigationRoutes(APP_ROUTES);
    expect(groups.map(({ group }) => group.label)).toEqual(["系统工具", "工具集", "支撑"]);
    expect(groups.map(({ routes }) => routes.map((route) => route.id))).toEqual([
      ["environment", "appConfig", "aiConfig", "systemTools"],
      ["tools"],
      ["dashboard", "services", "settings"],
    ]);
  });

  it("keeps the applications and homebrew routes registered but out of the sidebar", () => {
    const registered = APP_ROUTES.map((route) => route.id);
    expect(registered).toContain("applications");
    expect(registered).toContain("homebrew");

    const navigable = primaryNavigationRoutes(APP_ROUTES).map((route) => route.id);
    expect(navigable).not.toContain("applications");
    expect(navigable).not.toContain("homebrew");
  });

  it("gives the system tools route its label, eyebrow and description", () => {
    const tools = APP_ROUTES.find((route) => route.id === "systemTools");
    expect(tools).toMatchObject({
      label: "系统工具",
      eyebrow: "系统工具",
      description: "本机常用系统工具入口。",
    });
  });

  it("keeps Caddy out of the sidebar and under the system tools page", () => {
    const caddy = APP_ROUTES.find((route) => route.id === "caddy");
    expect(caddy?.parent).toBe("systemTools");
    expect(primaryNavigationRoutes(APP_ROUTES).map((route) => route.id)).not.toContain("caddy");
  });

  it("highlights the parent entry while a child page is open", () => {
    expect(navigationRouteOf("caddy")).toBe("systemTools");
    expect(navigationRouteOf("systemTools")).toBe("systemTools");
    expect(navigationRouteOf("environment")).toBe("environment");
  });

  it("restores sidebar entries and child pages but not retired routes", () => {
    expect(isRestorableRoute("caddy")).toBe(true);
    expect(isRestorableRoute("systemTools")).toBe(true);
    expect(isRestorableRoute("settings")).toBe(true);
    expect(isRestorableRoute("applications")).toBe(false);
    expect(isRestorableRoute("homebrew")).toBe(false);
    expect(isRestorableRoute("unknown")).toBe(false);
  });

  it("describes the services page as launchd discovery, not Homebrew-only management", () => {
    const services = APP_ROUTES.find((route) => route.id === "services");
    expect(services?.description).toBe(
      "发现并查看本机常驻任务（launchd），管理自建任务。",
    );
    expect(services?.description).not.toContain("Homebrew");
  });

  it("places the tools page in its own group between system tools and the support group", () => {
    const ids = primaryNavigationRoutes(APP_ROUTES).map((route) => route.id);
    expect(ids.indexOf("tools")).toBe(ids.indexOf("systemTools") + 1);
    expect(ids.indexOf("dashboard")).toBe(ids.indexOf("tools") + 1);
  });
});
