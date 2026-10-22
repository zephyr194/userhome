import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyValidationReport } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { CaddyPage } from "./CaddyPage";
import { RawEditorView, type RawLoadState } from "./RawEditor";
import type { ValidationState } from "./rawEditorFlow";

const NOOP = () => undefined;

const READY: RawLoadState = { status: "ready", origin: "SAVED" };
const IDLE: ValidationState = { status: "idle" };
const SAVE_IDLE = { status: "idle" } as const;

function done(
  status: CaddyValidationReport["status"],
  overrides: Partial<CaddyValidationReport> = {},
  checkedText = "example.com {\n}\n",
): ValidationState {
  return {
    status: "done",
    allowExternalReferences: false,
    checkedText,
    report: {
      status,
      externalReferences: [],
      diagnostics: [],
      limitation: "validate 会 provision（加载）配置中的模块",
      ...overrides,
    },
  };
}

function view(overrides: Partial<Parameters<typeof RawEditorView>[0]> = {}) {
  return renderToStaticMarkup(
    <RawEditorView
      text="example.com {\n}\n"
      load={READY}
      validation={IDLE}
      save={SAVE_IDLE}
      onTextChange={NOOP}
      onValidate={NOOP}
      onAllowExternalAndValidate={NOOP}
      onCancel={NOOP}
      onSave={NOOP}
      {...overrides}
    />,
  );
}

describe("RawEditorView", () => {
  it("labels the monospace editor and states that validation is not a pure parse", () => {
    const markup = view();

    expect(markup).toMatch(/<label[^>]*>Caddyfile 原文<\/label>|Caddyfile 原文/);
    expect(markup).toContain("font-mono");
    expect(markup).toContain("校验不是纯解析");
    expect(markup).toContain("provision");
    expect(markup).toContain("原文按原样保存");
  });

  it("keeps the original text in the editor, including after a failed validation", () => {
    const failed: ValidationState = {
      status: "failed",
      error: { code: "INTERNAL", message: "boom", retryable: false },
      checkedText: "http://evil {\n",
    };

    const markup = view({ text: "http://evil {\n", validation: failed });

    expect(markup).toContain("http://evil {");
    expect(markup).toContain("校验请求失败");
    expect(markup).toContain("boom");
  });

  it("renders the success state with its stage-specific message", () => {
    expect(view({ validation: done("VALID", { stage: "VALIDATE" }) })).toContain("校验通过");
  });

  it("renders a failed stage with line numbers from the diagnostics", () => {
    const markup = view({
      validation: done("INVALID", {
        stage: "ADAPT",
        diagnostics: [{ line: 2, message: "Caddyfile:2: unknown directive: x" }],
      }),
    });

    expect(markup).toContain("校验未通过：结构解析失败（adapt）");
    expect(markup).toContain("第 2 行：Caddyfile:2: unknown directive: x");
  });

  it("offers the explicit external permission action only for external references", () => {
    const external = view({
      validation: done("EXTERNAL_REFERENCES", {
        externalReferences: [{ kind: "IMPORT", line: 1 }],
      }),
    });
    expect(external).toContain("含外部引用，需要显式允许");
    expect(external).toContain("允许外部引用并校验");

    expect(view({ validation: done("VALID") })).not.toContain("允许外部引用并校验");
    expect(view({ validation: done("INVALID", { stage: "ADAPT" }) })).not.toContain(
      "允许外部引用并校验",
    );
  });

  it("renders timeout, cancellation and output limits as distinct, non-verdict states", () => {
    expect(view({ validation: done("TIMEOUT") })).toContain("校验超时，已停止（结果未知）");
    expect(view({ validation: done("CANCELLED") })).toContain("已取消校验");
    expect(view({ validation: done("OUTPUT_TOO_LARGE") })).toContain("输出超过上限");
  });

  it("shows the cancel control only while a run is in progress", () => {
    const running: ValidationState = {
      status: "running",
      runId: "run-1",
      allowExternalReferences: false,
      checkedText: "a",
    };

    expect(view({ validation: running })).toContain("取消校验");
    expect(view({ validation: running })).toContain("正在校验");
    expect(view()).not.toContain("取消校验");
  });

  it("warns when a result describes text that has since changed", () => {
    const markup = view({ text: "changed\n", validation: done("VALID", {}, "old\n") });

    expect(markup).toContain("文本已修改，以下结果针对之前校验的内容。");
  });

  it("refuses to save over a saved original that could not be read", () => {
    const error: AppError = { code: "VALIDATION_FAILED", message: "不是有效文本", retryable: false };

    const markup = view({ load: { status: "failed", error } });

    expect(markup).toContain("保存已停用，以免覆盖现有文件");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>保存原文<\/button>/);
  });

  it("hides the whole editor without unmounting its content", () => {
    const markup = view({ hidden: true, text: "kept\n" });

    expect(markup).toMatch(/<section[^>]*hidden=""/);
    expect(markup).toContain("kept");
  });
});

describe("CaddyPage mode switch", () => {
  it("offers form and raw modes with pressed state and keeps the raw editor mounted", () => {
    const markup = renderToStaticMarkup(<CaddyPage />);

    expect(markup).toContain("表单规则");
    expect(markup).toContain("原文 Caddyfile");
    expect(markup).toContain('aria-labelledby="raw-editor-heading"');
  });
});
