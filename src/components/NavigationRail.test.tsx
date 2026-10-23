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
  it("keeps only the sidebar entries whatever entry is selected", () => {
    for (const routeId of ["systemTools", "aiConfig", "environment", "tools"] as const) {
      const markup = renderRail(routeId);
      expect(markup, routeId).not.toContain("<button");
      expect(markup, routeId).not.toContain("navigation-rail__sections");
      expect(markup, routeId).not.toContain('navigation-rail__section"');
      expect(markup, routeId).not.toContain("分区");
    }
  });

  it("does not list the sections of the selected tool in the sidebar", () => {
    const markup = renderRail("systemTools");
    for (const label of ["站点规则", "原文 Caddyfile", "Codex CLI"]) {
      expect(markup, label).not.toContain(label);
    }
  });

  it("renders three group headings, each labelling its own list", () => {
    const markup = renderRail("dashboard");
    expect(markup.match(/<ul/g)).toHaveLength(3);
    for (const [id, label] of [
      ["system-tools", "系统工具"],
      ["toolset", "工具集"],
      ["support", "支撑"],
    ]) {
      expect(markup, label).toContain(
        `<p class="navigation-rail__section-label" id="nav-group-${id}">${label}</p>`,
      );
      expect(markup, label).toContain(`<ul aria-labelledby="nav-group-${id}">`);
    }
  });

  it("lists the entries in the fixed order across the groups", () => {
    const markup = renderRail("dashboard");
    const hrefs = [...markup.matchAll(/<a href="#([A-Za-z]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([
      "environment",
      "appConfig",
      "aiConfig",
      "systemTools",
      "tools",
      "dashboard",
      "services",
      "settings",
    ]);
  });

  it("marks only the selected entry as the current page, with Caddy under system tools", () => {
    const markup = renderRail("systemTools");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/<a href="#systemTools"[^>]*aria-current="page"/);
    expect(markup).not.toContain('href="#caddy"');
  });

  it("keeps every entry linked, with no third-level controls", () => {
    expect(renderRail("dashboard").match(/<a href="#/g)).toHaveLength(8);
  });
});
