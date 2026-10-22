// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("点击返回控件以 systemTools 调用导航", () => {
    const onNavigate = vi.fn();
    render(
      <RouteNavigationContext.Provider value={onNavigate}>
        <CaddyPage />
      </RouteNavigationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "返回系统工具" }));
    expect(onNavigate).toHaveBeenCalledWith({ routeId: "systemTools" });
  });
});
