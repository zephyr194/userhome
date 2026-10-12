/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");
function productionTsx(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsx(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("visual system v4 cleanup", () => {
  it("removes the compatibility layer and legacy aliases", () => {
    expect(css).not.toContain("control-lab-compat");
    for (const alias of ["--surface:", "--surface-subtle:", "--surface-muted:", "--border:", "--text:", "--muted:", "--accent:"]) {
      expect(css).not.toContain(alias);
    }
  });

  it("keeps important only for reduced motion", () => {
    const importantLines = css.split("\n").filter((line) => line.includes("!important"));
    expect(importantLines).toHaveLength(4);
  });

  it("does not give passive shared components perimeter borders", () => {
    const sources = [
      "src/components/ui/Panel.tsx",
      "src/components/ui/StatusBadge.tsx",
      "src/components/AsyncState.tsx",
    ].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");
    expect(sources).not.toMatch(/border-border|border-success|border-warning|border-danger/);
  });

  it("removes repeated passive perimeter-border patterns from route markup", () => {
    const source = productionTsx(join(process.cwd(), "src/features"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source.match(/rounded-(?:md|control|panel)[^"\n]*\bborder\s+border-border/g) ?? []).toHaveLength(0);
  });
});
