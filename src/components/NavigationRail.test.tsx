import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, type AppRouteId } from "../app/routeDefinitions";
import { NavigationRail } from "./NavigationRail";

function renderRail(activeRouteId: AppRouteId): string {
  return renderToStaticMarkup(
    <NavigationRail
      activeRouteId={activeRouteId}
      onNavigate={() => undefined}
      routes={APP_ROUTES}
    />,
  );
}

describe("NavigationRail", () => {
  it("keeps only the group and tool levels whatever tool is selected", () => {
    for (const routeId of ["caddy", "aiConfig", "environment", "tools"] as const) {
      const markup = renderRail(routeId);
      expect(markup, routeId).not.toContain("<button");
      expect(markup, routeId).not.toContain("navigation-rail__sections");
      expect(markup, routeId).not.toContain('navigation-rail__section"');
      expect(markup, routeId).not.toContain("分区");
    }
  });

  it("does not list the sections of the selected tool in the sidebar", () => {
    const markup = renderRail("caddy");
    for (const label of ["站点规则", "原文 Caddyfile", "Codex CLI"]) {
      expect(markup, label).not.toContain(label);
    }
  });

  it("marks only the selected tool entry as the current page", () => {
    const markup = renderRail("caddy");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/<a href="#caddy"[^>]*aria-current="page"/);
  });

  it("keeps every tool entry linked, with no third-level controls", () => {
    expect(renderRail("dashboard").match(/<a href="#/g)).toHaveLength(8);
  });
});
