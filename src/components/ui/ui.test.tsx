import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Modal, Panel, StatusBadge } from "./index";

describe("shared ui primitives", () => {
  it("Button uses semantic control sizes and body typography", () => {
    const md = renderToStaticMarkup(<Button>保存</Button>);
    expect(md).toContain("min-h-control-md");
    expect(md).toContain("text-body");
    expect(md).toContain("focus-visible:shadow-focus");
    expect(md).toContain("disabled:opacity-50");
    expect(md).not.toContain("truncate");
    expect(md).not.toContain("line-clamp");

    const sm = renderToStaticMarkup(<Button size="sm">取消</Button>);
    expect(sm).toContain("min-h-control-sm");
    expect(sm).toContain("text-aux");
  });

  it("StatusBadge keeps metadata size and wraps long content", () => {
    const markup = renderToStaticMarkup(
      <StatusBadge tone="warning">需要注意</StatusBadge>,
    );
    expect(markup).toContain("min-h-status-badge");
    expect(markup).toContain("text-meta");
    expect(markup).toContain("break-words");
    expect(markup).toContain("bg-warning-soft");
    expect(markup).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(markup).not.toContain("truncate");
  });

  it("Panel renders token surface colors", () => {
    const markup = renderToStaticMarkup(<Panel>内容</Panel>);
    expect(markup).toContain("bg-surface");
    expect(markup).not.toContain("border-border");
    expect(markup).toContain("text-foreground");
  });

  it("Modal backdrop and typography come from semantic tokens", () => {
    const markup = renderToStaticMarkup(
      <Modal open onClose={() => undefined} title="确认">
        内容
      </Modal>,
    );
    expect(markup).toContain("bg-backdrop");
    expect(markup).not.toContain("bg-neutral-950");
    expect(markup).toContain("text-group");
    expect(markup).toContain("text-body");
  });
});
