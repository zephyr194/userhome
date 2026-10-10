/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);

const start = css.indexOf("control-lab-compat:start");
const end = css.indexOf("control-lab-compat:end");
const compat = css.slice(start, end);

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

describe("Control Lab compat layer", () => {
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

  it("bounds the compat layer between explicit markers", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(compat.length).toBeGreaterThan(0);
  });

  it("never hard-codes colours in the compat layer", () => {
    const colourPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    expect(compat).not.toMatch(colourPattern);
  });

  it("never truncates meaningful text anywhere", () => {
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/line-clamp/);
    expect(compat).not.toMatch(/white-space:\s*nowrap/);
  });

  it("never hides descriptions or help inside a media query", () => {
    const helpSelector = /description|toolbar p|groups-header p|section-kicker|help/i;
    const offenders = mediaRuleBodies(css).filter(
      (rule) => /display:\s*none/.test(rule.body) && helpSelector.test(rule.selector),
    );
    expect(offenders).toEqual([]);
  });
});
