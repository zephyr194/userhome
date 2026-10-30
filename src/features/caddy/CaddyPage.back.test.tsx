// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationContext } from "../../app/routeNavigation";
import { CaddyPage } from "./CaddyPage";

vi.mock("../../ipc/caddy", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../ipc/caddy")>();
  const pending = () => new Promise<never>(() => undefined);
  return {
    ...original,
    caddyDetect: pending,
    caddyLoadRules: pending,
    caddyPreview: pending,
    caddySave: pending,
    caddyTlsStatus: pending,
  };
});

describe("Caddy 页返回系统工具", () => {
  afterEach(() => {
    cleanup();
  });

  it("只有在路由层提供导航时才显示返回控件", () => {
    expect(renderToStaticMarkup(<CaddyPage />)).not.toContain("返回系统工具");
    const withRoute = renderToStaticMarkup(
      <RouteNavigationContext.Provider value={() => undefined}>
        <CaddyPage />
      </RouteNavigationContext.Provider>,
    );
    expect(withRoute).toContain("返回系统工具");
    expect(withRoute).toContain("caddy-back");
  });

  it("返回控件是导航链接而非按钮，可从页面位置导航区域到达", () => {
    const onNavigate = vi.fn();
    render(
      <RouteNavigationContext.Provider value={onNavigate}>
        <CaddyPage />
      </RouteNavigationContext.Provider>,
    );
    const nav = screen.getByRole("navigation", { name: "页面位置" });
    const link = within(nav).getByRole("link", { name: "返回系统工具" });
    expect(link.getAttribute("href")).toBe("#systemTools");
    expect(screen.queryByRole("button", { name: "返回系统工具" })).toBeNull();
  });

  it("点击返回链接以 systemTools 调用导航，并阻止默认跳转", () => {
    const onNavigate = vi.fn();
    render(
      <RouteNavigationContext.Provider value={onNavigate}>
        <CaddyPage />
      </RouteNavigationContext.Provider>,
    );
    const link = screen.getByRole("link", { name: "返回系统工具" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith({ routeId: "systemTools" });
  });
});
