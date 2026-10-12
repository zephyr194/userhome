/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);


/** Extract the body of every rule nested inside an @media block. */
function mediaRuleBodies(source: string): { selector: string; body: string }[] {
  const blocks: { selector: string; body: string }[] = [];
  const media = /@media[^{]+\{/g;
  while (media.exec(source)) {
    let depth = 1;
    let i = media.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    const inner = source.slice(media.lastIndex, i - 1);
    for (const rule of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      blocks.push({ selector: rule[1].trim(), body: rule[2] });
    }
    media.lastIndex = i;
  }
  return blocks;
}

describe("single v4 route visual system", () => {
  it("keeps a CSS definition for every committed workspace class", () => {
    const workspaceClasses = [
      "dashboard-workspace",
      "system-pulse",
      "overview-panel",
      "attention-list",
      "machine-summary",
      "software-service-grid",
      "applications-workspace__header",
      "applications-workspace__filters",
      "applications-workspace__body",
      "brew-workspace",
      "brew-inventory-row",
      "services-inventory-row",
      "settings-pane",
      "settings-pane__detail-header",
      "settings-pane__detail-content",
    ];
    for (const className of workspaceClasses) {
      expect(css).toContain(`.${className}`);
    }
  });

  it("contains no compatibility marker or legacy alias", () => {
    expect(css).not.toContain("control-lab-compat");
    for (const alias of [
      "--surface:", "--surface-subtle:", "--surface-muted:", "--border:",
      "--text:", "--foreground:", "--muted:", "--accent:",
    ]) expect(css).not.toContain(alias);
  });

  it("keeps important only for reduced-motion overrides", () => {
    expect(css.match(/!important/g) ?? []).toHaveLength(4);
  });

  it("never truncates meaningful text anywhere", () => {
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/line-clamp/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });

  it("never hides descriptions or help inside a media query", () => {
    const helpSelector = /description|toolbar p|groups-header p|section-kicker|help/i;
    const offenders = mediaRuleBodies(css).filter(
      (rule) => /display:\s*none/.test(rule.body) && helpSelector.test(rule.selector),
    );
    expect(offenders).toEqual([]);
  });
});
