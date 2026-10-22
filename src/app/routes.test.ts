import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, groupNavigationRoutes } from "./routeDefinitions";

describe("caddy route wiring", () => {
  it("is a registered route that the route panel renders with the Caddy page", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(APP_ROUTES.map((route) => route.id)).toContain("caddy");
    expect(source).toContain('route.id === "caddy"');
    expect(source).toContain("<CaddyPage />");
  });
});

describe("application config route wiring", () => {
  it("is reachable from the system tools navigation and rendered by the route panel", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");
    const tools = groupNavigationRoutes(APP_ROUTES).find(
      (entry) => entry.group.id === "system-tools",
    );

    expect(tools?.routes.map((route) => route.id)).toContain("appConfig");
    expect(source).toContain('route.id === "appConfig"');
    expect(source).toContain("<AppConfigPage");
    expect(source).toContain("refreshId={");
  });
});

describe("AI config route wiring", () => {
  it("is reachable from the system tools navigation and rendered by the route panel", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");
    const tools = groupNavigationRoutes(APP_ROUTES).find(
      (entry) => entry.group.id === "system-tools",
    );

    expect(tools?.routes.map((route) => route.id)).toContain("aiConfig");
    expect(source).toContain('route.id === "aiConfig"');
    expect(source).toContain("<AiConfigPage />");
  });
});
