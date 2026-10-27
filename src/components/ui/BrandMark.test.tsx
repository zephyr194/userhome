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

type Attrs = Record<string, string>;
const attributes = (text: string): Attrs =>
  Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const rects = (svg: string): Attrs[] => [...svg.matchAll(/<rect\s([^>]*?)\/?>/g)].map((m) => attributes(m[1]));
const geometry = (rect: Attrs) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, rx: rect.rx });

describe("BrandMark", () => {
  it("renders a decorative svg with the framed mark, the cropped viewBox and no text", () => {
    const markup = renderToStaticMarkup(<BrandMark className="brand-size" />);
    expect(markup).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(markup).toContain('class="brand-size"');
    expect(markup).toContain('viewBox="100 100 824 824"');
    expect(markup.replace(/<[^>]+>/g, "").trim()).toBe("");
    expect(markup.match(/<rect /g)).toHaveLength(4);
    expect(rects(markup)[0]).toMatchObject({
      class: "brand-mark__frame",
      x: "100",
      y: "100",
      width: "824",
      height: "824",
      rx: "184",
    });
  });

  it("draws the three blocks with the same geometry as the icon source, accent on top", () => {
    const markup = renderToStaticMarkup(<BrandMark />);
    const source = readFileSync(
      fileURLToPath(new URL("../../../src-tauri/icons/icon-source.svg", import.meta.url)),
      "utf8",
    );
    const blocks = rects(markup).filter((rect) => (rect.class ?? "").startsWith("brand-mark__block"));
    expect(blocks.map(geometry)).toEqual(rects(source).slice(1).map(geometry));
    const accents = blocks.filter((rect) => (rect.class ?? "").includes("brand-mark__block--accent"));
    expect(accents.map(geometry)).toEqual([{ x: "416.0", y: "300.8", width: "192.0", height: "192.0", rx: "57.6" }]);
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

  it("keeps the light brand block on the icon's steel-blue palette", () => {
    expect(lightBlock()).toMatch(/--app-brand-bg:\s*#F8FBFC;/);
    expect(lightBlock()).toMatch(/--app-brand-fg:\s*#2A4A5C;/);
    expect(lightBlock()).toMatch(/--app-brand-accent:\s*#14B8A6;/);
  });

  it("gives the explicit and system dark brand blocks the same icon palette", () => {
    for (const dark of [darkBlock(), systemDarkBlock()]) {
      expect(dark).toMatch(/--app-brand-bg:\s*#1B2A33;/);
      expect(dark).toMatch(/--app-brand-fg:\s*#DCEBF1;/);
      expect(dark).toMatch(/--app-brand-accent:\s*#3DD9C4;/);
      expect(dark).toMatch(/--app-brand-accent-deep:\s*#B65C24;/);
    }
  });
});
