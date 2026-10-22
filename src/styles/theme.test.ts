/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);


function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("global theme tokens", () => {
  it("uses the approved cool steel-gray palette", () => {
    for (const value of [
      "#EDF1F5", "#F8FAFC", "#FFFFFF", "#1D242D", "#4F5B69",
      "#B65C24", "#A64D1D", "#2B744F", "#8C5F12", "#B33A3A",
      "#15191E", "#1D2228", "#2C333C", "#E6EBF1", "#F0A060",
    ]) expect(css.toUpperCase()).toContain(value);
    expect(css).not.toMatch(
      /#f5f6f8|#171c24|#1663b7|#82baff|#f5f1ea|#fcfaf6|#746a5e|#a94f1f|#948678|#f0eae2|#d8cec1|#efe9e0|#e7ddd1|#c8bcae|#a99989|#5e554b|#f3e3d7|#29241e|#171512|#211e1a|#2a2621|#f3ece2|#b8ada0|#4f473e|#7c7062|#1b1815|#2b2722|#cfc4b7/i,
    );
  });

  it("keeps matching cool dark semantics for explicit and system appearances", () => {
    expect(css).toMatch(/:root\[data-appearance="dark"\]/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-appearance="system"\]/);
    expect(css.toUpperCase()).toContain("#15191E");
  });

  it("keeps keyboard focus visible in forced-colors without outline", () => {
    expect(css).toMatch(/forced-colors:\s*active/);
    expect(css).toMatch(/forced-color-adjust:\s*none/);
    expect(css).toMatch(/box-shadow:[\s\S]*Highlight/);
  });

  it("contains no component-level outline utilities", () => {
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (
          /\.(?:tsx|ts)$/.test(entry.name) &&
          !entry.name.includes(".test.")
        ) {
          files.push(path);
        }
      }
    };
    visit(join(process.cwd(), "src"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/(?:focus-visible:)?outline(?:-|:)/);
  });

  it("uses opaque state surfaces and no author outline except the global reset", () => {
    expect(css).not.toMatch(/--app-(?:success|warning|danger)-soft:\s*color-mix/);
    const outlineDeclarations = css.match(/(?:^|[;{])\s*outline\s*:/gm) ?? [];
    expect(outlineDeclarations).toHaveLength(1);
    expect(css).toMatch(/outline:\s*none/);
    expect(css).toMatch(/:focus-visible\s*\{\s*box-shadow:\s*none/);
    expect(css).toMatch(/:is\(input, select, textarea\):focus-visible\s*\{\s*border-color/);
  });

  it("meets text and control contrast across every approved surface", () => {
    const lightSurfaces = ["#EDF1F5", "#F8FAFC", "#E3E9EF", "#FFFFFF"];
    const darkSurfaces = ["#15191E", "#1D2228", "#262C34", "#2C333C"];
    for (const foreground of [
      "#1D242D", "#4F5B69", "#A64D1D", "#2B744F", "#8C5F12", "#B33A3A",
    ]) {
      for (const surface of lightSurfaces) {
        expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const foreground of [
      "#E6EBF1", "#AEB9C6", "#F0A060", "#65C894", "#E3B85B", "#EE7D78",
    ]) {
      for (const surface of darkSurfaces) {
        expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const surface of lightSurfaces) {
      expect(contrast("#6B7785", surface)).toBeGreaterThanOrEqual(3);
    }
    for (const surface of darkSurfaces) {
      expect(contrast("#7F8B99", surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("issues shared typography and control size tokens", () => {
    expect(css).toMatch(/--text-body:/);
    expect(css).toMatch(/--text-aux:/);
    expect(css).toMatch(/--text-meta:/);
    expect(css).toMatch(/--text-group:/);
    expect(css).toMatch(/--text-page-title:/);
    expect(css).toMatch(/--app-control-height-sm:\s*24px/);
    expect(css).toMatch(/--app-control-height-md:\s*28px/);
  });
});
