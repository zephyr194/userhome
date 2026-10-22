import { describe, expect, it } from "vitest";
import {
  APP_ROUTES,
  isRestorableRoute,
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

  it("lists the sidebar entries flat, in the fixed order", () => {
    expect(primaryNavigationRoutes(APP_ROUTES).map((route) => route.label)).toEqual([
      "概览",
      "环境变量",
      "应用配置",
      "AI 工具",
      "系统工具",
      "工具集",
      "服务",
      "设置",
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

  it("places the tools page between system tools and services", () => {
    const labels = primaryNavigationRoutes(APP_ROUTES).map((route) => route.id);
    expect(labels.indexOf("tools")).toBe(labels.indexOf("systemTools") + 1);
    expect(labels.indexOf("services")).toBe(labels.indexOf("tools") + 1);
  });
});
