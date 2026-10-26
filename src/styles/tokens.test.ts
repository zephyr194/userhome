/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    declaredLight: Object.keys(light),
    states: {
      light: resolveAll(light),
      darkExplicit: resolveAll({ ...light, ...merge(buckets.darkExplicit) }),
      darkSystem: resolveAll({ ...light, ...merge(buckets.darkSystem) }),
    },
    responsive: { [NARROW_MEDIA]: resolveAll(merge(buckets.narrow)) },
  };
}

const parsed = parseRootStates(css);

const RENAMED_TOKENS: Declarations = {
  "--r4-signal": "--app-signal",
  "--r8-aisearch-mark-bg": "--app-search-mark-bg",
};

function renamed(map: Declarations): Declarations {
  return Object.fromEntries(Object.entries(map).map(([name, value]) => [RENAMED_TOKENS[name] ?? name, value]));
}

function pick(map: Declarations, names: readonly string[]): Declarations {
  return Object.fromEntries(names.map((name) => [name, map[name]]));
}

const SCOPED_LOCALS = [
  "--app-line-height-row",
  "--app-page-master-width",
  "--app-page-status-dot",
  "--r12-shell-notice-max-width",
];

const ACCENT_TOKENS = [
  "--app-primary",
  "--app-primary-hover",
  "--app-primary-soft",
  "--app-primary-foreground",
  "--app-accent-text",
  "--app-focus-ring",
  "--app-selection",
  "--app-selection-border",
  "--app-selection-foreground",
  "--app-signal",
  "--app-search-mark-bg",
  "--app-sidebar-current-foreground",
  "--app-sidebar-current-border",
  "--app-brand-accent",
  "--app-brand-accent-deep",
] as const;

const MOTION_TIERS = ["--app-motion-duration-fast", "--app-motion-duration-base", "--app-motion-duration-slow"] as const;

// shadow-[var(--app-shadow-raised)] 在 Modal.tsx、forms/index.tsx、e2e/E2eFormProbe.tsx 中是已知的令牌引用，允许
const FORBIDDEN_ARBITRARY = ["rounded-[", "bg-[", "text-[#", "shadow-[", "duration-[", "ease-["];

function tsxFiles(): string[] {
  const root = fileURLToPath(new URL("../", import.meta.url));
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => join(root, file));
}

describe("theme token baseline (resolved from global.css, pre-migration)", () => {
  it.each(["light", "darkExplicit", "darkSystem"] as const)(
    "resolves every %s token to the baseline value",
    (state) => {
      const expected = renamed(baseline.states[state]);
      expect(pick(parsed.states[state], Object.keys(expected))).toEqual(expected);
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

describe("token definitions live in one zone", () => {
  it("defines app and round-scoped tokens only inside the token zone", () => {
    const zoneStart = css.search(/^:root \{/m);
    const zoneEnd = css.indexOf("\n* {\n");
    expect(zoneStart).toBeGreaterThan(css.indexOf("@theme inline"));
    expect(zoneEnd).toBeGreaterThan(zoneStart);
    const outside = css.slice(0, zoneStart) + css.slice(zoneEnd);
    const defined = new Set([...outside.matchAll(/^\s*(--(?:app|r\d+)-[\w-]+)\s*:/gm)].map((m) => m[1]));
    expect([...defined].sort()).toEqual([...SCOPED_LOCALS].sort());
  });

  it("no longer uses the orphan round-scoped token names", () => {
    expect(css).not.toMatch(/--r4-signal|--r8-aisearch-mark-bg/);
  });
});

describe("accent token contract", () => {
  it.each(ACCENT_TOKENS)("defines %s in the light block and both dark states", (name) => {
    expect(parsed.declaredLight).toContain(name);
    expect(parsed.states.darkExplicit[name]).toBeDefined();
    expect(parsed.states.darkSystem[name]).toBeDefined();
  });

  it("keeps the explicit and system dark accent values identical", () => {
    expect(pick(parsed.states.darkSystem, ACCENT_TOKENS)).toEqual(pick(parsed.states.darkExplicit, ACCENT_TOKENS));
  });

  it("groups the accent tokens as one contiguous run in the light block", () => {
    const lightBody = css.match(/^:root \{([^}]*)\}/m)?.[1] ?? "";
    const names = [...lightBody.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]);
    const indexes = ACCENT_TOKENS.map((name) => names.indexOf(name));
    expect(Math.min(...indexes)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...indexes) - Math.min(...indexes) + 1).toBe(ACCENT_TOKENS.length);
  });
});

describe("motion tiers and shadow tier", () => {
  it.each(MOTION_TIERS)("%s reuses an existing duration from the baseline", (tier) => {
    const existing = ["--app-motion-state", "--app-motion-switch", "--app-motion-slide"].map(
      (name) => baseline.states.light[name],
    );
    expect(existing).toContain(parsed.states.light[tier]);
  });

  it("keeps the legacy motion names as aliases of the new tiers", () => {
    expect(parsed.states.light["--app-motion-state"]).toBe(parsed.states.light["--app-motion-duration-fast"]);
    expect(parsed.states.light["--app-motion-switch"]).toBe(parsed.states.light["--app-motion-duration-base"]);
    expect(parsed.states.light["--app-motion-slide"]).toBe(parsed.states.light["--app-motion-duration-slow"]);
  });

  it.each(["light", "darkExplicit", "darkSystem"] as const)(
    "gives --app-shadow-float the same value as --app-shadow-raised in %s",
    (state) => {
      expect(parsed.states[state]["--app-shadow-float"]).toBe(parsed.states[state]["--app-shadow-raised"]);
    },
  );
});

describe("theme-related arbitrary values stay out of TSX", () => {
  it("uses no literal arbitrary radius, colour, shadow, duration or easing utilities", () => {
    const literal = (pattern: string) => new RegExp(`${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!var\\(--app-)`);
    const offenders = tsxFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN_ARBITRARY.filter((pattern) => literal(pattern).test(text)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });
});
