/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const rawCss = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");

interface CssRule {
  selector: string;
  context: string[];
  body: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function parseCss(source: string): CssRule[] {
  const text = stripComments(source);
  const rules: CssRule[] = [];
  const open: { header: string; start: number }[] = [];
  let header = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") {
      open.push({ header: header.trim(), start: i + 1 });
      header = "";
    } else if (char === "}") {
      const block = open.pop();
      const body = block ? text.slice(block.start, i) : "";
      if (block && !body.includes("{")) {
        rules.push({
          selector: block.header,
          context: open.map((entry) => entry.header),
          body,
        });
      }
      header = "";
    } else if (char === ";") {
      header = "";
    } else {
      header += char;
    }
  }
  return rules;
}

const cssRules = parseCss(rawCss);
const isTokenRule = (rule: CssRule) =>
  rule.selector.startsWith(":root") || rule.selector.startsWith("@theme");

function productionFiles(dir: string, pattern: RegExp, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) productionFiles(path, pattern, files);
    else if (pattern.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const productionTsx = productionFiles(srcRoot, /\.tsx$/);
const relativePath = (file: string) => relative(srcRoot, file).split(sep).join("/");
const tsxSources = productionTsx.map((file) => ({
  key: relativePath(file),
  source: readFileSync(file, "utf8"),
}));

const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
function stringLiterals(source: string): string[] {
  return [...source.matchAll(STRING_LITERAL)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;
const APPROVED_RADIUS_VALUES = new Set([
  "0",
  "1px",
  "2px",
  "50%",
  "var(--app-radius-control)",
  "var(--app-radius-panel)",
]);
const FORBIDDEN_RADIUS_CLASS = /(?<![\w-])rounded-(?:lg|xl|2xl|3xl)(?![\w-])|rounded-\[/;
const FORBIDDEN_RADIUS_PX = /\b999px\b/;
const HEIGHT_CLASS = /(?<![\w-])(?:min-)?h-control-(sm|md)(?![\w-])/;
const VERTICAL_PADDING = /(?<![\w-])(?:py|pt|pb)-/;

describe("圆角审计（UI-4 全局扫描）", () => {
  it("global.css 所有圆角属性只用 0、1px、2px、50% 或圆角令牌，且无 999px", () => {
    const radii = cssRules.flatMap((rule) =>
      [...rule.body.matchAll(/(?<![\w-])(?:border(?:-[a-z]+)*-)?radius:\s*([^;]+)/g)].map(
        (match) => match[1].trim(),
      ),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((value) => !APPROVED_RADIUS_VALUES.has(value) || FORBIDDEN_RADIUS_PX.test(value))).toEqual([]);
  });

  it("TSX 不使用 rounded-lg/xl/2xl/3xl、任意值圆角或 999px", () => {
    const violations = tsxSources.flatMap(({ key, source }) => [
      ...[...source.matchAll(new RegExp(FORBIDDEN_RADIUS_CLASS, "g"))].map((match) => `${key}: ${match[0]}`),
      ...(FORBIDDEN_RADIUS_PX.test(source) ? [`${key}: 999px`] : []),
    ]);
    expect(violations).toEqual([]);
  });
});

describe("写死颜色审计（UI-4 全局扫描）", () => {
  it("TSX 不出现 #hex、rgb()、hsl()", () => {
    const violations = tsxSources
      .filter(({ source }) => LITERAL_COLOR.test(source))
      .map(({ key }) => key);
    expect(violations).toEqual([]);
  });

  it("global.css 的字面量颜色只出现在令牌块（:root 与 @theme）中", () => {
    const violations = cssRules
      .filter((rule) => LITERAL_COLOR.test(rule.body) && !isTokenRule(rule))
      .map((rule) => `${rule.context.join(" > ")} ${rule.selector}`.trim());
    expect(violations).toEqual([]);
  });
});

describe("控件高度令牌与垂直内边距互斥（UI-4 全局扫描）", () => {
  // textarea 高度由 min-h 自行定义，不使用控件高度令牌，故白名单为空
  const TEXTAREA_EXCEPTIONS: readonly string[] = [];

  it("全部生产 TSX 的类名字面量中，高度令牌与垂直内边距不得共存", () => {
    const violations: string[] = [];
    for (const { key, source } of tsxSources) {
      if (TEXTAREA_EXCEPTIONS.includes(key)) continue;
      for (const literal of stringLiterals(source)) {
        if (HEIGHT_CLASS.test(literal) && VERTICAL_PADDING.test(literal)) {
          violations.push(`${key}: ${literal}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("clip-path 与 !important（UI-4 全局扫描）", () => {
  it("全仓生产代码（global.css 与 TSX）不使用 clip-path", () => {
    const violations = [
      ...cssRules.filter((rule) => /clip-path/.test(rule.body)).map((rule) => rule.selector),
      ...tsxSources.filter(({ source }) => /clip-path|clipPath/.test(source)).map(({ key }) => key),
    ];
    expect(violations).toEqual([]);
  });

  it("!important 在 global.css 中恰为 4 处（仅 reduced motion），TSX 中不使用", () => {
    expect(rawCss.match(/!important/g) ?? []).toHaveLength(4);
    const tailwindImportant = tsxSources.flatMap(({ key, source }) =>
      stringLiterals(source)
        .filter((literal) => /(?:^|\s)![a-z][\w-]*(?=\s|$)/.test(literal))
        .map((literal) => `${key}: ${literal}`),
    );
    expect(tailwindImportant).toEqual([]);
  });
});

describe("未定义的语义颜色类（UI-4 全局扫描）", () => {
  const themeBody = cssRules.find((rule) => rule.selector === "@theme inline")?.body ?? "";
  const COLOR_TOKENS = new Set([...themeBody.matchAll(/--color-([a-z0-9]+(?:-[a-z0-9]+)*):/g)].map((m) => m[1]));
  const TEXT_TOKENS = new Set([...themeBody.matchAll(/--text-([a-z0-9]+(?:-[a-z0-9]+)*):/g)].map((m) => m[1]));
  const COLOR_UTILITY = /^(?:text|bg|border|ring|divide)-(.+)$/;

  // Tailwind 内置的非颜色用法，以及作为颜色关键字的 white/black/transparent/current/inherit
  const BUILTIN_COLOR_KEYWORDS = /^(?:white|black|transparent|current|inherit)$/;
  const NON_COLOR_UTILITY: Record<string, RegExp> = {
    text: /^(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
    border: /^(?:[xytrblse]?(?:-?\d+)?|solid|dashed|dotted|double|hidden|none|collapse|separate)$/,
    bg: /^(?:cover|contain|fixed|local|scroll|none|no-repeat|repeat(?:-[xy])?|center|top|bottom|left|right|origin-.+|clip-.+)$/,
    ring: /^(?:inset|\d+|offset-\d+)$/,
    divide: /^(?:[xy]?(?:-?\d+)?|reverse)$/,
  };

  it("每个 text/bg/border/ring/divide 语义颜色类都在 @theme 中有 --color-* 定义", () => {
    const violations: string[] = [];
    for (const { key, source } of tsxSources) {
      for (const literal of stringLiterals(source)) {
        for (const token of literal.split(/\s+/)) {
          if (/[${}]/.test(token)) continue;
          const bare = token.slice(token.lastIndexOf(":") + 1).replace(/^!/, "").replace(/\/.*$/, "");
          const match = COLOR_UTILITY.exec(bare);
          if (!match) continue;
          const [, name] = match;
          const prefix = bare.slice(0, bare.indexOf("-"));
          if (name.startsWith("[")) {
            violations.push(`${key}: ${token}（任意值）`);
          } else if (COLOR_TOKENS.has(name) || BUILTIN_COLOR_KEYWORDS.test(name)) {
            continue;
          } else if (prefix === "text" && TEXT_TOKENS.has(name)) {
            continue;
          } else if (NON_COLOR_UTILITY[prefix]?.test(name)) {
            continue;
          } else {
            violations.push(`${key}: ${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("不使用渐变类（bg-gradient/bg-linear 及 from-/via-/to- 色标）", () => {
    const violations = tsxSources.flatMap(({ key, source }) =>
      stringLiterals(source).flatMap((literal) =>
        literal
          .split(/\s+/)
          .filter((token) => /^(?:bg-(?:gradient|linear|radial|conic)|(?:from|via|to)-)/.test(token.slice(token.lastIndexOf(":") + 1)))
          .map((token) => `${key}: ${token}`),
      ),
    );
    expect(violations).toEqual([]);
  });
});

describe("sticky 元素必须带顶部 1px 分隔线（UI-4 全局扫描）", () => {
  it("生产 TSX 中带 sticky 的类名同时含 border-t 与 border-line", () => {
    const violations = tsxSources.flatMap(({ key, source }) =>
      stringLiterals(source)
        .filter((literal) => /(?<![\w-])sticky(?![\w-])/.test(literal))
        .filter((literal) => !(/(?<![\w-])border-t(?![\w-])/.test(literal) && /(?<![\w-])border-line(?![\w-])/.test(literal)))
        .map((literal) => `${key}: ${literal}`),
    );
    expect(violations).toEqual([]);
  });

  it("global.css 中 position: sticky 的规则带顶部分隔线", () => {
    const violations = cssRules
      .filter((rule) => /position:\s*sticky/.test(rule.body))
      .filter((rule) => !/border-top(?:-width)?:|border-top:/.test(rule.body))
      .map((rule) => rule.selector);
    expect(violations).toEqual([]);
  });
});

describe("窄宽度与收缩策略（静态，不能替代真机缩放）", () => {
  const declarations = (selector: string, context: string[] = []) =>
    cssRules
      .filter((rule) => rule.selector === selector && rule.context.join("|") === context.join("|"))
      .map((rule) => rule.body)
      .join("\n")
      .replace(/\s+/g, " ");
  const MEDIA_760 = ["@media (max-width: 760px)"];

  it("html 与 body 保持 min-width: 320px", () => {
    expect(declarations("html")).toContain("min-width: 320px");
    expect(declarations("body")).toContain("min-width: 320px");
  });

  it("应用外壳与工作区为 grid + minmax(0, 1fr)，并裁切溢出", () => {
    expect(declarations(".app-shell")).toContain("overflow: hidden");
    const workspace = declarations(".desktop-workspace");
    expect(workspace).toContain("grid-template-columns: var(--app-sidebar-width) minmax(0, 1fr)");
    expect(workspace).toContain("overflow: hidden");
  });

  it("侧栏、主内容与标题栏允许收缩（min-width: 0）", () => {
    expect(declarations(".desktop-workspace__sidebar")).toContain("min-width: 0");
    expect(declarations(".desktop-workspace__main")).toContain("min-width: 0");
    expect(declarations(".titlebar")).toContain("min-width: 0");
  });

  it("760px 以下侧栏收为 58px 图标栏并隐藏导航文字", () => {
    expect(declarations(":root", MEDIA_760)).toContain("--app-sidebar-width: 58px");
    expect(declarations(".navigation-rail__label", MEDIA_760)).toContain("display: none");
  });

  it("工作区的列表、详情、横幅与操作进度均带 min-w-0", () => {
    const workspace = readFileSync(join(srcRoot, "components/DesktopWorkspace.tsx"), "utf8");
    expect(workspace).toMatch(/desktop-workspace__list min-w-0/);
    expect(workspace).toMatch(/desktop-workspace__detail min-w-0/);
    expect(workspace).toMatch(/desktop-workspace__banner min-w-0/);
    expect(workspace).toMatch(/desktop-workspace__operation-progress min-w-0/);
  });
});
