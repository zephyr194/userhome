import { describe, expect, it } from "vitest";
import { routeSectionsOf } from "./routeDefinitions";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

describe("route section labels", () => {
  it("keeps zh-CN labels by default", () => {
    expect(routeSectionsOf("caddy").map((section) => section.label)).toEqual([
      "站点规则",
      "运行",
      "原文 Caddyfile",
    ]);
  });

  it("returns English labels for the environment and Caddy sections", () => {
    const labels = [...routeSectionsOf("environment", "en"), ...routeSectionsOf("caddy", "en")].map(
      (section) => section.label,
    );
    expect(labels).toHaveLength(6);
    for (const label of labels) {
      expect(CJK_PATTERN.test(label), label).toBe(false);
    }
  });
});
