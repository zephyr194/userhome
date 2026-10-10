/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);

describe("global theme tokens", () => {
  it("restores light semantics on :root", () => {
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toContain("#f5f6f8");
    expect(css).toContain("--app-control-border");
    expect(css).toContain("--app-tertiary-foreground");
    expect(css).toContain("--app-backdrop");
  });

  it("keeps dark semantics for explicit and system appearances", () => {
    expect(css).toMatch(/:root\[data-appearance="dark"\]/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-appearance="system"\]/);
    expect(css).toContain("#171c24");
  });

  it("does not force dark tokens on bare :root after the light theme", () => {
    expect(css).not.toContain("#080d14");
  });

  it("issues shared typography and control size tokens", () => {
    expect(css).toMatch(/--text-body:/);
    expect(css).toMatch(/--text-aux:/);
    expect(css).toMatch(/--text-meta:/);
    expect(css).toMatch(/--text-group:/);
    expect(css).toMatch(/--text-page-title:/);
    expect(css).toMatch(/--app-control-height-sm:\s*32px/);
    expect(css).toMatch(/--app-control-height-md:\s*36px/);
  });
});
