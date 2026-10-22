/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "../../app/routeDefinitions";
import { NavigationRail } from "../NavigationRail";
import { BrandMark } from "./BrandMark";

const css = readFileSync(fileURLToPath(new URL("../../styles/global.css", import.meta.url)), "utf8");
const BRAND_TOKENS = [
  "app-brand-bg",
  "app-brand-fg",
  "app-brand-rail",
  "app-brand-knob",
  "app-brand-accent",
  "app-brand-accent-deep",
] as const;

function block(pattern: RegExp): string {
  const match = css.match(pattern)?.[1];
  if (match === undefined) throw new Error(`missing block ${pattern}`);
  return match;
}

const lightBlock = () => block(/^:root \{([^}]*)\}/m);
const darkBlock = () => block(/:root\[data-appearance="dark"\]\s*\{([^}]*)\}/);
const systemDarkBlock = () =>
  block(/:root:not\(\[data-appearance\]\),\s*:root\[data-appearance="system"\]\s*\{([^}]*)\}/);

describe("BrandMark", () => {
  it("renders a decorative svg with the icon artwork and the cropped viewBox", () => {
    const markup = renderToStaticMarkup(<BrandMark className="brand-size" />);
    expect(markup).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(markup).toContain('class="brand-size"');
    expect(markup).toContain('viewBox="100 100 824 824"');
    expect(markup).toContain('d="M290 272 H386 V528 A126 126 0 0 0 638 528 V272 H734 V528 A222 222 0 0 1 290 528 Z"');
    expect(markup.match(/<rect /g)).toHaveLength(2);
  });
});

describe("NavigationRail brand block", () => {
  it("uses the BrandMark svg and drops the legacy glyph marker", () => {
    const markup = renderToStaticMarkup(
      <NavigationRail
        activeRouteId="dashboard"
        onNavigate={() => undefined}
        routes={APP_ROUTES}
      />,
    );
    const brand = markup.match(/<div class="navigation-rail__brand">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(brand).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(brand).toContain("CONTROL LAB");
    expect(brand).not.toContain("navigation-rail__mark");
    expect(brand).not.toContain("<i>");
  });

  it("removes the legacy glyph styles", () => {
    expect(css).not.toContain(".navigation-rail__mark");
  });
});

describe("brand tokens", () => {
  it("defines every brand token for light, explicit dark, and system dark appearances", () => {
    for (const token of BRAND_TOKENS) {
      expect(css.match(new RegExp(`--${token}:`, "g"))).toHaveLength(3);
      expect(lightBlock()).toMatch(new RegExp(`--${token}:`));
      expect(darkBlock()).toMatch(new RegExp(`--${token}:`));
      expect(systemDarkBlock()).toMatch(new RegExp(`--${token}:`));
    }
  });

  it("keeps the light brand block on the icon's cool steel-gray", () => {
    expect(lightBlock()).toMatch(/--app-brand-bg:\s*#1D242D;/);
    expect(lightBlock()).toMatch(/--app-brand-fg:\s*#E6EBF1;/);
    expect(lightBlock()).toMatch(/--app-brand-accent:\s*#F0A060;/);
  });

  it("lifts the dark brand background above the sidebar without changing the mark colors", () => {
    for (const dark of [darkBlock(), systemDarkBlock()]) {
      expect(dark).toMatch(/--app-brand-bg:\s*#262C34;/);
      expect(dark).toMatch(/--app-brand-accent:\s*#F0A060;/);
      expect(dark).toMatch(/--app-brand-accent-deep:\s*#B65C24;/);
    }
    expect(darkBlock()).toMatch(/--app-brand-fg:\s*#E6EBF1;/);
    expect(systemDarkBlock()).toMatch(/--app-brand-fg:\s*#E6EBF1;/);
  });
});
