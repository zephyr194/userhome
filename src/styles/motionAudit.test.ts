/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const REDUCED_MEDIA = "@media (prefers-reduced-motion: reduce)";
const KEYFRAMES_PREFIX = "@keyframes ";
const TIMED_PROPERTIES = new Set(["transition", "transition-duration", "animation", "animation-duration"]);
const TIMING_TOKENS = new Set([
  "--app-motion-duration-fast",
  "--app-motion-duration-base",
  "--app-motion-duration-slow",
  "--app-motion-state",
  "--app-motion-switch",
  "--app-motion-slide",
  "--app-motion-ease-standard",
  "--app-motion-ease-enter",
  "--app-motion-ease-exit",
]);
const ANIMATABLE = new Set(["opacity", "transform", "color", "background-color", "border-color", "box-shadow"]);
const INDICATOR = ".slide-list[data-slide-ready]::before";
const INDICATOR_EXTRA = new Set(["width", "height"]);

type Rule = { ancestors: string[]; selector: string; declarations: [string, string][] };

function declarationEntries(body: string): [string, string][] {
  return body.split(";").flatMap((part) => {
    const index = part.indexOf(":");
    return index === -1 ? [] : [[part.slice(0, index).trim(), part.slice(index + 1).trim()] as [string, string]];
  });
}

function parseRules(text: string, ancestors: string[] = [], out: Rule[] = []): Rule[] {
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
    if (prelude.startsWith("@")) parseRules(body, [...ancestors, prelude], out);
    else out.push({ ancestors, selector: prelude, declarations: declarationEntries(body) });
    pos = i;
  }
  return out;
}

const rules = parseRules(css);
const keyframeRules = rules.filter((rule) => rule.ancestors.some((a) => a.startsWith(KEYFRAMES_PREFIX)));
const styleRules = rules.filter((rule) => !rule.ancestors.some((a) => a.startsWith(KEYFRAMES_PREFIX)));
const keyframeNames = [
  ...new Set(
    rules
      .flatMap((rule) => rule.ancestors)
      .filter((a) => a.startsWith(KEYFRAMES_PREFIX))
      .map((a) => a.slice(KEYFRAMES_PREFIX.length).trim()),
  ),
];
const isReduced = (rule: Rule) => rule.ancestors.includes(REDUCED_MEDIA);

const NAMED_LITERAL_EXEMPTIONS = [
  { selector: ".r4-fe5-refreshed", property: "animation", literal: "3s", reason: "通知停留时长，非过渡时长" },
  { selector: ".status-glyph--busy", property: "animation", literal: "1s", reason: "旋转 spinner 循环时长" },
  { selector: ".motion-skeleton__bar", property: "animation", literal: "1.2s", reason: "骨架脉动循环时长（规格 1.2s）" },
];

function literalTimeAudit() {
  const offenders: string[] = [];
  const hits = NAMED_LITERAL_EXEMPTIONS.map(() => 0);
  for (const rule of styleRules) {
    for (const [name, value] of rule.declarations) {
      if (!TIMED_PROPERTIES.has(name)) continue;
      for (const [, token] of value.matchAll(/var\((--app-motion-[\w-]+)\)/g)) {
        if (!TIMING_TOKENS.has(token)) offenders.push(`${rule.selector} ${name}: ${token}`);
      }
      const literals = value.replace(/var\([^)]*\)/g, "").match(/\d*\.?\d+m?s\b/g) ?? [];
      if (isReduced(rule) && literals.every((literal) => literal === "0.01ms")) continue;
      for (const literal of literals) {
        const index = NAMED_LITERAL_EXEMPTIONS.findIndex(
          (item) => item.selector === rule.selector && item.property === name && item.literal === literal,
        );
        if (index === -1) offenders.push(`${rule.selector} ${name}: ${value}`);
        else hits[index] += 1;
      }
    }
  }
  return { offenders, hits };
}

describe("motion audit: durations come from tokens", () => {
  it("时长只引用动效令牌，且不写字面毫秒（reduced-motion 的 0.01ms 与具名豁免除外）", () => {
    expect(literalTimeAudit().offenders).toEqual([]);
  });

  it("每个具名豁免恰好命中 1 处", () => {
    expect(literalTimeAudit().hits).toEqual(NAMED_LITERAL_EXEMPTIONS.map(() => 1));
  });
});

describe("motion audit: properties", () => {
  it("不用 transition: all，过渡属性只在白名单内（指示器的 width、height 例外）", () => {
    const offenders: string[] = [];
    for (const rule of styleRules) {
      for (const [name, value] of rule.declarations) {
        if (name !== "transition" && name !== "transition-property") continue;
        for (const item of value.split(",")) {
          const property = item.trim().split(/\s+/)[0];
          if (property === "none" || property === "") continue;
          const indicatorException = rule.selector === INDICATOR && INDICATOR_EXTRA.has(property);
          if (!ANIMATABLE.has(property) && !indicatorException) offenders.push(`${rule.selector}: ${property}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("@keyframes 只动画白名单属性", () => {
    const offenders: string[] = [];
    for (const rule of keyframeRules) {
      for (const [name] of rule.declarations) {
        if (!ANIMATABLE.has(name)) offenders.push(`${rule.ancestors.join(" ")} ${rule.selector}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("motion audit: reduced motion", () => {
  it("每个 @keyframes 的使用方在 reduced-motion 下都是 animation: none", () => {
    expect(keyframeNames.length).toBeGreaterThan(0);
    for (const name of keyframeNames) {
      const pattern = new RegExp(`(^|[\\s,])${name}(\\s|,|$)`);
      const users = styleRules.filter((rule) =>
        rule.declarations.some(([prop, value]) => (prop === "animation" || prop === "animation-name") && pattern.test(value)),
      );
      expect(users.length, name).toBeGreaterThan(0);
      for (const user of users) {
        const disabled = styleRules.some(
          (rule) =>
            isReduced(rule) &&
            rule.selector.split(",").map((part) => part.trim()).includes(user.selector) &&
            rule.declarations.some(([prop, value]) => prop === "animation" && value === "none"),
        );
        expect(disabled, `${name} @ ${user.selector}`).toBe(true);
      }
    }
  });
});

describe("motion surfaces: dialog, popover, notices", () => {
  const ruleFor = (selector: string, reduced = false) =>
    styleRules.find(
      (rule) =>
        rule.selector.split(",").map((part) => part.trim()).includes(selector) && isReduced(rule) === reduced,
    );
  const valueOf = (rule: Rule | undefined, property: string) =>
    rule?.declarations.find(([name]) => name === property)?.[1];

  it("弹窗面板进入 base、退出 fast，退出时缩放到 0.98", () => {
    const enter = ruleFor(".motion-dialog");
    expect(valueOf(enter, "transition-duration")).toBe("var(--app-motion-duration-base)");
    expect(valueOf(enter, "transition-timing-function")).toBe("var(--app-motion-ease-enter)");
    const closed = ruleFor(".motion-dialog[data-closed]");
    expect(valueOf(closed, "transform")).toBe("scale(0.98)");
    expect(valueOf(closed, "transition-duration")).toBe("var(--app-motion-duration-fast)");
    expect(valueOf(closed, "transition-timing-function")).toBe("var(--app-motion-ease-exit)");
  });

  it("下拉面板淡入加 translateY(-4px)，退出用 fast 与 exit 缓动", () => {
    expect(valueOf(ruleFor(".motion-popover"), "transition-duration")).toBe("var(--app-motion-duration-base)");
    const closed = ruleFor(".motion-popover[data-closed]");
    expect(valueOf(closed, "transform")).toBe("translateY(-4px)");
    expect(valueOf(closed, "transition-duration")).toBe("var(--app-motion-duration-fast)");
  });

  it("通知浮层进入时淡入并从 -8px 滑入", () => {
    const notices = ruleFor('.desktop-workspace__banner[data-overlay="notices"]');
    expect(valueOf(notices, "animation")).toBe(
      "motion-notice-in var(--app-motion-duration-base) var(--app-motion-ease-enter)",
    );
    const from = rules.find((rule) => rule.ancestors.some((a) => a === "@keyframes motion-notice-in") && rule.selector === "from");
    expect(valueOf(from, "transform")).toBe("translateY(-8px)");
  });

  it("动效规则不挡操作（不使用 pointer-events: none）", () => {
    const motionRules = styleRules.filter((rule) => rule.selector.includes("motion-") || rule.selector.includes('data-overlay="notices"'));
    expect(motionRules.length).toBeGreaterThan(0);
    for (const rule of motionRules) {
      expect(valueOf(rule, "pointer-events"), rule.selector).toBeUndefined();
    }
  });

  it("reduced-motion 下弹窗、下拉与通知浮层都关闭过渡与动画", () => {
    for (const selector of [".motion-dialog", ".motion-dialog[data-closed]", ".motion-popover", ".motion-popover[data-closed]"]) {
      expect(valueOf(ruleFor(selector, true), "transition"), selector).toBe("none");
    }
    expect(valueOf(ruleFor('.desktop-workspace__banner[data-overlay="notices"]', true), "animation")).toBe("none");
  });
});
