/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, StatusBadge } from "./index";
import {
  CheckboxField,
  SelectField,
  SwitchField,
  TextField,
} from "./forms";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(
  fileURLToPath(new URL("../../styles/global.css", import.meta.url)),
  "utf8",
);

const HEIGHT_CLASS = /(?<![\w-])(?:min-)?h-control-(sm|md)(?![\w-])/;
const VERTICAL_PADDING = /(?<![\w-])(?:py|pt|pb)-/;
const TEXTAREA_EXCEPTIONS: readonly string[] = [];

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function tokenPx(size: "sm" | "md"): number {
  return Number.parseFloat(tokenValue(`app-control-height-${size}`));
}

function heightTier(classes: string): "sm" | "md" | undefined {
  return HEIGHT_CLASS.exec(classes)?.[1] as "sm" | "md" | undefined;
}

function classOf(markup: string, opening: RegExp): string {
  for (const match of markup.matchAll(/<[a-z]+\b[^>]*>/g)) {
    if (opening.test(match[0])) {
      return match[0].match(/class="([^"]*)"/)?.[1] ?? "";
    }
  }
  throw new Error(`no element matching ${opening} in markup`);
}

// 单行内容高度 = 行高（令牌为 px）+ 边框，须小于控件令牌，单行时高度才恰好等于令牌
function singleLineContentPx(classes: string): number {
  const size = /(?<![\w-])text-(meta|aux|body|group)(?![\w-])/.exec(classes)?.[1];
  if (!size) throw new Error(`no text size in: ${classes}`);
  const lineHeight = Number.parseFloat(tokenValue(`app-line-height-${size}`));
  const border = /(?<![\w-])border(?![\w-])/.test(classes) ? 2 : 0;
  return lineHeight + border;
}

function productionTsx(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) productionTsx(path, files);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("控件高度由令牌决定（UI-1c）", () => {
  it("令牌数值精确且两档不同、均不小于 20px", () => {
    expect(tokenPx("sm")).toBe(20);
    expect(tokenPx("md")).toBe(24);
    expect(tokenPx("sm")).toBeGreaterThanOrEqual(20);
    expect(tokenPx("md")).not.toBe(tokenPx("sm"));
  });

  it("Button md/sm 由同一对令牌驱动，且单行内容高度小于令牌", () => {
    const md = classOf(renderToStaticMarkup(<Button>保存</Button>), /^<button\b/);
    const sm = classOf(
      renderToStaticMarkup(<Button size="sm">取消</Button>),
      /^<button\b/,
    );

    expect(heightTier(md)).toBe("md");
    expect(heightTier(sm)).toBe("sm");
    expect(md).not.toMatch(VERTICAL_PADDING);
    expect(sm).not.toMatch(VERTICAL_PADDING);
    expect(singleLineContentPx(md)).toBeLessThan(tokenPx("md"));
    expect(singleLineContentPx(sm)).toBeLessThan(tokenPx("sm"));
  });

  it("输入框与下拉使用与 Button md 相同的高度令牌", () => {
    const input = classOf(
      renderToStaticMarkup(<TextField label="名称" name="name" />),
      /^<input\b/,
    );
    const select = classOf(
      renderToStaticMarkup(
        <SelectField
          label="模式"
          name="mode"
          options={[{ value: "safe", label: "安全" }]}
        />,
      ),
      /aria-haspopup="listbox"/,
    );

    expect(heightTier(input)).toBe("md");
    expect(heightTier(select)).toBe("md");
    expect(input).not.toMatch(VERTICAL_PADDING);
    expect(select).not.toMatch(VERTICAL_PADDING);
    expect(singleLineContentPx(input)).toBeLessThan(tokenPx("md"));
  });

  it("复选与开关的可聚焦行使用 sm 令牌，开关不再写死尺寸", () => {
    const checkbox = classOf(
      renderToStaticMarkup(<CheckboxField label="自动清理" name="prune" />),
      /role="checkbox"/,
    );
    const toggle = classOf(
      renderToStaticMarkup(<SwitchField label="启动时刷新" name="refresh" />),
      /role="switch"/,
    );

    expect(heightTier(checkbox)).toBe("sm");
    expect(heightTier(toggle)).toBe("sm");
    expect(toggle).not.toMatch(/(?<![\w-])h-5(?![\w-])/);
    expect(toggle).not.toMatch(VERTICAL_PADDING);
  });

  it("StatusBadge 使用 20px 令牌且无垂直内边距", () => {
    const badge = classOf(renderToStaticMarkup(<StatusBadge>运行中</StatusBadge>), /^<span\b/);

    expect(badge).toContain("min-h-status-badge");
    expect(badge).not.toMatch(VERTICAL_PADDING);
    expect(tokenValue("app-status-badge-height")).toBe("20px");
  });
});

const FORM_TAG =
  /<(TextField|SelectField|TextAreaField|SecretReplacementField|CheckboxField|SwitchField|RadioCardGroup|input|select|textarea)\b/;

// 人工复核过的“页面内既有 size=\"sm\" 按钮又有表单控件”的文件：sm 仅为错误容器内的补救按钮（见 buttonSizeAudit.test.ts）
const REVIEWED_SM_WITH_FORMS = [
  "features/ai-config/CommandBuilder.tsx",
  "features/ai-config/ToolReference.tsx",
  "features/app-config/AppConfigEditor.tsx",
  "features/environment/EnvironmentView.tsx",
  "features/services/ServicesView.tsx",
];

// 静态检测无法可靠判断“同一行”，故对已知的同排位置逐个断言为 md
const KNOWN_SAME_ROW_POSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["features/environment/DotenvEditor.tsx", "\"env.editor.dotenv.entry.removeAria\""],
  ["features/environment/ZshEditor.tsx", "\"env.editor.zsh.var.removeAria\""],
  ["features/environment/ZshEditor.tsx", "\"env.editor.zsh.var.removeRowAria\""],
];

function sizeAfter(source: string, marker: string): string | undefined {
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`marker not found: ${marker}`);
  return source.slice(index).match(/size="(sm|md)"/)?.[1];
}

describe("同排混档（页面清点）", () => {
  it("已知同排的按钮与输入框位置均为 md", () => {
    for (const [file, marker] of KNOWN_SAME_ROW_POSITIONS) {
      const source = readFileSync(join(srcRoot, file), "utf8");
      expect(sizeAfter(source, marker), `${file} ${marker}`).toBe("md");
    }
  });

  it("含 sm 按钮且含表单控件的页面文件均已逐一复核", () => {
    const files = productionTsx(join(srcRoot, "features"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /size="sm"/.test(source) && FORM_TAG.test(source);
      })
      .map((file) => relative(srcRoot, file).split(sep).join("/"))
      .sort();
    expect(files).toEqual([...REVIEWED_SM_WITH_FORMS].sort());
  });
});

describe("控件高度类与垂直内边距互斥（扫描）", () => {
  it("生产 TSX 的类名字面量中，高度令牌与垂直内边距不得共存", () => {
    const violations: string[] = [];
    const roots = [join(srcRoot, "components", "ui"), join(srcRoot, "features")];
    const literal = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
    for (const root of roots) {
      for (const file of productionTsx(root)) {
        const key = relative(srcRoot, file).split(sep).join("/");
        for (const match of readFileSync(file, "utf8").matchAll(literal)) {
          const value = match[1] ?? match[2] ?? match[3] ?? "";
          if (HEIGHT_CLASS.test(value) && VERTICAL_PADDING.test(value)) {
            if (TEXTAREA_EXCEPTIONS.includes(key)) continue;
            violations.push(`${key}: ${value}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
