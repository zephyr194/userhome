/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const baseline: Baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL("./tokens.baseline.json", import.meta.url)), "utf8"),
);

type Declarations = Record<string, string>;
type Baseline = {
  source: string;
  states: Record<State, Declarations>;
  responsive: Record<string, Declarations>;
};
type State = "light" | "darkExplicit" | "darkSystem";
type Rule = { ancestors: string[]; selector: string; body: string };

const DARK_SYSTEM_MEDIA = "@media (prefers-color-scheme: dark)";
const NARROW_MEDIA = "@media (max-width: 760px)";
const DARK_SYSTEM_SELECTORS = [":root:not([data-appearance])", ':root[data-appearance="system"]'];

function splitRules(text: string, ancestors: string[], out: Rule[]): Rule[] {
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf("{", pos);
    if (open === -1) break;
    let prelude = text.slice(pos, open);
    const semi = prelude.lastIndexOf(";");
    if (semi !== -1) prelude = prelude.slice(semi + 1);
    prelude = prelude.trim();
    let depth = 1;
    let i = open + 1;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const body = text.slice(open + 1, i - 1);
    if (prelude.startsWith("@")) {
      splitRules(body, [...ancestors, prelude], out);
    } else {
      out.push({ ancestors, selector: prelude, body });
    }
    pos = i;
  }
  return out;
}

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

function resolveVars(value: string, tokens: Declarations, seen: string[] = []): string {
  return value.replace(/var\((--[\w-]+)\)/g, (match, name: string) => {
    if (seen.includes(name)) throw new Error(`cyclic token ${name}`);
    const next = tokens[name];
    if (next === undefined) return match;
    return resolveVars(next, tokens, [...seen, name]);
  });
}

function resolveAll(map: Declarations): Declarations {
  const out: Declarations = {};
  for (const key of Object.keys(map).sort()) out[key] = resolveVars(map[key], map);
  return out;
}

function parseRootStates(source: string) {
  const buckets: Record<State | "narrow", Declarations[]> = {
    light: [],
    darkExplicit: [],
    darkSystem: [],
    narrow: [],
  };
  for (const rule of splitRules(source, [], [])) {
    const selectors = rule.selector.split(",").map((s) => s.trim());
    if (!selectors.some((s) => s.includes(":root"))) continue;
    const single = selectors.length === 1;
    if (rule.ancestors.length === 0 && rule.selector === ":root") {
      buckets.light.push(declarations(rule.body));
    } else if (rule.ancestors.length === 0 && rule.selector === ':root[data-appearance="dark"]') {
      buckets.darkExplicit.push(declarations(rule.body));
    } else if (
      rule.ancestors.length === 1 &&
      rule.ancestors[0] === DARK_SYSTEM_MEDIA &&
      selectors.join("|") === DARK_SYSTEM_SELECTORS.join("|")
    ) {
      buckets.darkSystem.push(declarations(rule.body));
    } else if (rule.ancestors.length === 1 && rule.ancestors[0] === NARROW_MEDIA && single) {
      buckets.narrow.push(declarations(rule.body));
    } else {
      throw new Error(`unclassified :root rule under ${rule.ancestors.join(" ")}: ${rule.selector}`);
    }
  }
  const merge = (list: Declarations[]) => Object.assign({}, ...list) as Declarations;
  const light = merge(buckets.light);
  return {
    states: {
      light: resolveAll(light),
      darkExplicit: resolveAll({ ...light, ...merge(buckets.darkExplicit) }),
      darkSystem: resolveAll({ ...light, ...merge(buckets.darkSystem) }),
    },
    responsive: { [NARROW_MEDIA]: resolveAll(merge(buckets.narrow)) },
  };
}

const parsed = parseRootStates(css);

describe("theme token baseline (resolved from global.css, pre-migration)", () => {
  it.each(["light", "darkExplicit", "darkSystem"] as const)(
    "resolves every %s token to the baseline value",
    (state) => {
      expect(parsed.states[state]).toEqual(baseline.states[state]);
    },
  );

  it("keeps the narrow-viewport sidebar override", () => {
    expect(parsed.responsive).toEqual(baseline.responsive);
  });

  it("covers tokens declared in the per-round blocks", () => {
    const light = baseline.states.light;
    for (const name of [
      "--app-motion-slide",
      "--app-selection-secondary",
      "--app-code-comment",
      "--app-code-section",
      "--r4-signal",
      "--r8-aisearch-mark-bg",
    ]) {
      expect(light[name], name).toBeDefined();
      expect(baseline.states.darkExplicit[name], name).toBeDefined();
      expect(baseline.states.darkSystem[name], name).toBeDefined();
    }
  });
});
