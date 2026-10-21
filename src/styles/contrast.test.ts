/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);

type Declarations = Record<string, string>;
type Rgb = { r: number; g: number; b: number; a: number };

function declarations(body: string): Declarations {
  const result: Declarations = {};
  for (const part of body.split(";")) {
    const index = part.indexOf(":");
    if (index !== -1) {
      result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return result;
}

function block(pattern: RegExp): Declarations {
  const match = css.match(pattern);
  if (!match) throw new Error(`CSS block not found: ${pattern.source}`);
  return declarations(match[1]);
}

const lightBlock = block(/^:root \{([^}]*)\}/m);
const darkExplicitBlock = block(
  /^:root\[data-appearance="dark"\] \{([^}]*)\}/m,
);
const darkSystemBlock = block(
  /@media \(prefers-color-scheme: dark\) \{[\s\S]*?:root:not\(\[data-appearance\]\),\s*:root\[data-appearance="system"\]\s*\{([^}]*)\}/,
);

const darkTokens: Declarations = { ...lightBlock, ...darkExplicitBlock };
const themes = { light: lightBlock, dark: darkTokens } as const;

function resolveVars(value: string, tokens: Declarations, seen: string[] = []): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`cyclic token ${name}`);
    const next = tokens[name];
    if (next === undefined) throw new Error(`unknown token ${name}`);
    return resolveVars(next, tokens, [...seen, name]);
  });
}

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = value.match(
    /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/,
  );
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  throw new Error(`unsupported colour value ${value}`);
}

function opaqueColor(tokens: Declarations, name: string): Rgb {
  const value = tokens[name];
  if (value === undefined) throw new Error(`missing token ${name}`);
  const color = parseColor(resolveVars(value, tokens));
  if (color.a !== 1) throw new Error(`${name} must be opaque for contrast`);
  return color;
}

function luminance({ r, g, b }: Rgb): number {
  const [R, G, B] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT = 4.5;
const UI = 3;

const surfaces = [
  "--app-canvas",
  "--app-surface",
  "--app-surface-muted",
  "--app-surface-raised",
  "--app-sidebar",
  "--app-sidebar-hover",
];

const checks: Array<[foreground: string, background: string, minimum: number]> = [
  ...["--app-foreground", "--app-muted-foreground", "--app-tertiary-foreground"].flatMap(
    (foreground) => surfaces.map((background): [string, string, number] => [foreground, background, TEXT]),
  ),
  ...["--app-sidebar", "--app-sidebar-hover"].map((background): [string, string, number] => [
    "--app-sidebar-foreground",
    background,
    TEXT,
  ]),
  ...[
    "--app-canvas",
    "--app-surface",
    "--app-surface-muted",
    "--app-surface-raised",
    "--app-sidebar",
    "--app-primary-soft",
  ].map((background): [string, string, number] => ["--app-accent-text", background, TEXT]),
  ["--app-selection-foreground", "--app-selection", TEXT],
  ...["--app-surface", "--app-canvas", "--app-success-soft"].map((background): [string, string, number] => [
    "--app-success-text",
    background,
    TEXT,
  ]),
  ...["--app-surface", "--app-canvas", "--app-warning-soft"].map((background): [string, string, number] => [
    "--app-warning-text",
    background,
    TEXT,
  ]),
  ...["--app-surface", "--app-canvas", "--app-danger-soft"].map((background): [string, string, number] => [
    "--app-danger-text",
    background,
    TEXT,
  ]),
  ["--app-primary-foreground", "--app-primary", TEXT],
  ["--app-primary-foreground", "--app-primary-hover", TEXT],
  ["--app-danger-foreground", "--app-danger", TEXT],
  ["--app-danger-foreground", "--app-danger-hover", TEXT],
  ...["--app-surface", "--app-canvas", "--app-surface-raised"].map((background): [string, string, number] => [
    "--app-control-border",
    background,
    UI,
  ]),
  ...["--app-surface", "--app-canvas", "--app-surface-muted", "--app-sidebar"].map(
    (background): [string, string, number] => ["--app-focus-ring", background, UI],
  ),
];

describe("token contrast, resolved from global.css", () => {
  for (const [themeName, tokens] of Object.entries(themes)) {
    it.each(
      checks.map(([foreground, background, minimum]) => ({
        theme: themeName,
        foreground,
        background,
        minimum,
      })),
    )(
      "$theme: $foreground on $background is at least $minimum:1",
      ({ foreground, background, minimum }) => {
        const ratio = contrastRatio(
          opaqueColor(tokens, foreground),
          opaqueColor(tokens, background),
        );
        expect(ratio).toBeGreaterThanOrEqual(minimum);
      },
    );
  }
});

describe("dark token declarations stay in sync", () => {
  it("gives the explicit dark and system dark selectors identical values", () => {
    expect(darkSystemBlock).toEqual(darkExplicitBlock);
  });

  it("keeps color-scheme matched to each appearance", () => {
    expect(lightBlock["color-scheme"]).toBe("light");
    expect(darkExplicitBlock["color-scheme"]).toBe("dark");
    expect(darkSystemBlock["color-scheme"]).toBe("dark");
  });
});
