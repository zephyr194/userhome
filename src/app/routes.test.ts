import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "./routeDefinitions";

describe("caddy route wiring", () => {
  it("is a registered route that the route panel renders with the Caddy page", () => {
    const source = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

    expect(APP_ROUTES.map((route) => route.id)).toContain("caddy");
    expect(source).toContain('route.id === "caddy"');
    expect(source).toContain("<CaddyPage />");
  });
});
