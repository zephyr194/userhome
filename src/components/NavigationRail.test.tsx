import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, type AppRouteId } from "../app/routeDefinitions";
import { NavigationRail } from "./NavigationRail";

function renderRail(activeRouteId: AppRouteId, activeSectionId?: string): string {
  return renderToStaticMarkup(
    <NavigationRail
      activeRouteId={activeRouteId}
      activeSectionId={activeSectionId}
      onNavigate={() => undefined}
      routes={APP_ROUTES}
    />,
  );
}

describe("NavigationRail sections", () => {
  it("lists the Caddy sections under the selected tool with the current one marked", () => {
    const markup = renderRail("caddy", "run");
    const list = markup.match(/<ul aria-label="Caddy分区"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(list.match(/<button/g)).toHaveLength(3);
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    expect(list).toMatch(/<button[^>]*aria-current="true"[^>]*>运行<\/button>/);
  });

  it("lists the AI config sections for the AI config tool only", () => {
    const markup = renderRail("aiConfig", "codex");
    expect(markup.match(/navigation-rail__section"/g)).toHaveLength(4);
    expect(markup).toMatch(/<button[^>]*aria-current="true"[^>]*>Codex CLI<\/button>/);
  });

  it("keeps the sections of other tools collapsed", () => {
    expect(renderRail("dashboard")).not.toContain('navigation-rail__section"');
    expect(renderRail("caddy", "rules")).not.toContain("AI 配置分区");
  });

  it("leaves the sections of the selected tool out when none are declared", () => {
    expect(renderRail("tools")).not.toContain("navigation-rail__sections");
  });
});
