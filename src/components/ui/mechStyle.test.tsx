/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsyncState } from "../AsyncState";
import { LogViewer, Modal, Panel, StatusBadge } from "./index";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8");

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing token --${name}`);
  return match[1].trim();
}

function rulesFor(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",").map((part) => part.trim()).includes(selector))
    .map((match) => match[2]);
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function toMs(value: string): number {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  if (!match) throw new Error(`unparsed duration ${value}`);
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

describe("Panel 锐角与角标", () => {
  it("默认不带角标，保留容器圆角与发丝线", () => {
    const markup = renderToStaticMarkup(<Panel>内容</Panel>);
    expect(markup).not.toContain("corner-ticks");
    expect(markup).toContain("rounded-panel");
    expect(markup).toContain("ring-inset");
    expect(markup).toContain("ring-line");
    expect(markup).not.toMatch(/\bborder-(border|success|warning|danger)\b/);
  });

  it("启用 ticks 后带 corner-ticks 工具类，且仍保留内容与属性", () => {
    const markup = renderToStaticMarkup(
      <Panel aria-label="概览" ticks>
        内容
      </Panel>,
    );
    expect(markup).toContain("corner-ticks");
    expect(markup).toContain('aria-label="概览"');
    expect(markup).toContain("内容");
  });

  it("角标只用伪元素、不拦截指针，并定位在面板内侧", () => {
    expect(rulesFor(".corner-ticks")[0]).toMatch(/position:\s*relative/);
    expect(rulesFor(".corner-ticks")[0]).toMatch(/isolation:\s*isolate/);
    for (const selector of [".corner-ticks::before", ".corner-ticks::after"]) {
      const body = rulesFor(selector).join("\n");
      expect(body, selector).toMatch(/content:\s*""/);
      expect(body, selector).toMatch(/position:\s*absolute/);
      expect(body, selector).toMatch(/pointer-events:\s*none/);
      expect(body, selector).toMatch(/z-index:\s*-1/);
    }
    expect(tokenValue("app-corner-tick-length")).toBe("6px");
    expect(tokenValue("app-corner-tick-inset")).toBe("4px");
  });
});

describe("全仓不使用 clip-path", () => {
  it("生产 CSS 与 TSX 中不出现 clip-path", () => {
    const offenders = productionFiles(srcRoot).filter((path) =>
      readFileSync(path, "utf8").includes("clip-path"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("StatusBadge 等宽大写标签", () => {
  it("保留文字内容与 aria 属性", () => {
    const markup = renderToStaticMarkup(
      <StatusBadge aria-label="连接状态：失败" role="status" tone="danger">
        连接失败
      </StatusBadge>,
    );
    expect(markup).toContain("连接失败");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="连接状态：失败"');
  });

  it("使用等宽、大写与不超过 0.04em 的字距，并走状态过渡", () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="success">OK</StatusBadge>);
    expect(markup).toContain("font-mono");
    expect(markup).toContain("uppercase");
    expect(markup).toContain("state-transition");
    expect(tokenValue("app-letter-spacing-label")).toBe("0.04em");
  });
});

describe("Modal 对话框", () => {
  it("保持 dialog 角色与 aria 标注", () => {
    const markup = renderToStaticMarkup(
      <Modal open onClose={() => undefined} title="确认删除" titleId="confirm-title">
        内容
      </Modal>,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="confirm-title"');
    expect(markup).toContain("确认删除");
  });

  it("4px 容器圆角、1px 发丝线、标题栏底部分隔线，阴影使用 raised 令牌", () => {
    const markup = renderToStaticMarkup(
      <Modal open onClose={() => undefined} title="确认">
        内容
      </Modal>,
    );
    expect(markup).toContain("rounded-panel");
    expect(markup).toContain("ring-line");
    expect(markup).toContain("border-b border-line");
    expect(markup).toContain("var(--app-shadow-raised)");
    expect(markup).not.toMatch(/rounded-(lg|xl|2xl|3xl)\b/);
    expect(tokenValue("app-radius-panel")).toBe("var(--app-radius-container)");
  });

  it("过渡与背景淡入淡出走 state-transition，不再使用 duration-150", () => {
    const source = readFileSync(join(srcRoot, "components/ui/Modal.tsx"), "utf8");
    expect(source).toContain("state-transition");
    expect(source).not.toMatch(/\bduration-\d/);
    expect(source).not.toContain("transition-opacity");
  });
});

describe("过渡与动效", () => {
  it("状态过渡时长令牌 ≤120ms，且 state-transition 使用线性缓动", () => {
    expect(toMs(tokenValue("app-motion-state"))).toBeLessThanOrEqual(120);
    const body = rulesFor(".state-transition").join("\n");
    expect(body).toMatch(/transition-duration:\s*var\(--app-motion-state\)/);
    expect(body).toMatch(/transition-timing-function:\s*linear/);
  });

  it("global.css 中所有 transition 声明的时长 ≤120ms（减少动效规则除外）", () => {
    const declarations = [...css.matchAll(/transition(?:-duration)?:\s*([^;]+);/g)].map(
      (match) => match[1],
    );
    expect(declarations.length).toBeGreaterThan(0);
    for (const value of declarations) {
      const durations = value.match(/\d*\.?\d+m?s\b/g) ?? [];
      for (const duration of durations) {
        expect(toMs(duration), value).toBeLessThanOrEqual(120.01);
      }
    }
  });

  it("仍只有 reduced-motion 中的 4 处 !important", () => {
    expect(css.split("\n").filter((line) => line.includes("!important"))).toHaveLength(4);
  });
});

describe("AsyncState 与 LogViewer", () => {
  it("AsyncState 使用令牌圆角与状态过渡，状态仍有文字", () => {
    const markup = renderToStaticMarkup(<AsyncState kind="error">加载失败。</AsyncState>);
    expect(markup).toContain("rounded-control");
    expect(markup).toContain("state-transition");
    expect(markup).toContain("加载失败");
    expect(markup).toContain("错误：");
  });

  it("LogViewer 日志区使用等宽字体与紧凑行高，仍是可聚焦的 log 区域", () => {
    const markup = renderToStaticMarkup(<LogViewer label="Caddy 日志" lines={["一行"]} />);
    expect(markup).toContain('role="log"');
    expect(markup).toContain("font-mono");
    expect(markup).toContain("leading-snug");
    expect(markup).toContain('tabindex="0"');
  });
});

describe("sticky 页脚顶部分隔线", () => {
  it("line 颜色令牌映射为 Tailwind 语义色", () => {
    expect(css).toContain("--color-line: var(--app-line-subtle);");
  });
});
