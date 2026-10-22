import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, primaryNavigationRoutes } from "./routeDefinitions";

const sidebarIds = () => primaryNavigationRoutes(APP_ROUTES).map((route) => route.id);

describe("caddy route wiring", () => {
  it("is a registered route that the route panel renders with the Caddy page", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(APP_ROUTES.map((route) => route.id)).toContain("caddy");
    expect(source).toContain('route.id === "caddy"');
    expect(source).toContain("<CaddyPage />");
  });

  it("is reached from the system tools page, not from its own sidebar entry", () => {
    expect(sidebarIds()).not.toContain("caddy");
    expect(sidebarIds()).toContain("systemTools");
    expect(APP_ROUTES.find((route) => route.id === "caddy")?.parent).toBe("systemTools");
  });
});

describe("system tools route wiring", () => {
  it("is rendered by the route panel with the card page", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(source).toContain('route.id === "systemTools"');
    expect(source).toContain("<SystemToolsPage");
  });
});

describe("application config route wiring", () => {
  it("is reachable from the sidebar and rendered by the route panel", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(sidebarIds()).toContain("appConfig");
    expect(source).toContain('route.id === "appConfig"');
    expect(source).toContain("<AppConfigPage");
    expect(source).toContain("refreshId={");
  });
});

describe("AI config route wiring", () => {
  it("is reachable from the sidebar and rendered by the route panel", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(sidebarIds()).toContain("aiConfig");
    expect(source).toContain('route.id === "aiConfig"');
    expect(source).toContain("<AiConfigPage");
  });
});
