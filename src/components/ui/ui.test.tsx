import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionRow,
  Button,
  LogViewer,
  Modal,
  Panel,
  SecretValue,
  StatusBadge,
} from "./index";

describe("shared ui primitives", () => {
  it("ActionRow lays out wrapping, centered actions with the 8px token gap", () => {
    const markup = renderToStaticMarkup(<ActionRow>保存</ActionRow>);
    expect(markup).toContain("flex flex-wrap items-center gap-ui-8");
    expect(markup).not.toContain("justify-end");
    const end = renderToStaticMarkup(<ActionRow align="end">保存</ActionRow>);
    expect(end).toContain("justify-end");
  });

  it("ActionRow can bottom-align its actions beside a labelled select", () => {
    const markup = renderToStaticMarkup(<ActionRow alignItems="end">格式化</ActionRow>);
    expect(markup).toContain("flex flex-wrap items-end gap-ui-8");
    expect(markup).not.toContain("items-center");
  });

  it("Button uses semantic control sizes and body typography", () => {
    const md = renderToStaticMarkup(<Button>保存</Button>);
    expect(md).toContain("min-h-control-md");
    expect(md).toContain("text-body");
    expect(md).not.toContain("shadow-focus");
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
    expect(markup).toContain("text-aux");
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

describe("LogViewer initial render", () => {
  it("renders an accessible, keyboard-reachable log region", () => {
    const markup = renderToStaticMarkup(
      <LogViewer label="Caddy 日志" lines={["第一行", "第二行"]} />,
    );
    expect(markup).toContain('aria-label="Caddy 日志"');
    expect(markup).toContain('role="log"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain("shadow-focus");
    expect(markup).toContain("第一行");
    expect(markup).toContain("第二行");
    expect(markup).toContain("暂停");
    expect(markup).toContain("复制");
    expect(markup).toContain('type="search"');
    expect(markup).not.toContain("已丢弃");
  });

  it("shows a visible truncation notice when lines exceed the limit", () => {
    const markup = renderToStaticMarkup(
      <LogViewer
        label="日志"
        lines={["a", "b", "c", "d"]}
        maxLines={2}
        droppedCount={5}
      />,
    );
    expect(markup).toContain("已丢弃较早的 7 行");
    expect(markup).toContain("仅保留最近 2 行");
    expect(markup).not.toContain(">a<");
    expect(markup).toContain(">d<");
  });

  it("renders log content as text, never as HTML", () => {
    const markup = renderToStaticMarkup(
      <LogViewer label="日志" lines={["<img src=x onerror=alert(1)>"]} />,
    );
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });

  it("shows an empty state and a sensitive-content reminder", () => {
    const markup = renderToStaticMarkup(<LogViewer label="日志" lines={[]} />);
    expect(markup).toContain("暂无日志");
    expect(markup).toContain("敏感");
  });
});

describe("SecretValue initial render", () => {
  const SECRET = "sk-live-0123456789-do-not-leak";

  it("is masked by default and never puts the plaintext in markup", () => {
    const markup = renderToStaticMarkup(
      <SecretValue label="OPENAI_API_KEY" value={SECRET} />,
    );
    expect(markup).toContain("••••••••");
    expect(markup).not.toContain(SECRET);
    expect(markup).not.toContain("sk-live");
    expect(markup).toContain('aria-label="显示 OPENAI_API_KEY 的值"');
    expect(markup).toContain('aria-label="复制 OPENAI_API_KEY 的值"');
    expect(markup).not.toContain("shadow-focus");
    expect(markup).toContain('role="status"');
  });

  it("masks values of any length with the same fixed mask", () => {
    const short = renderToStaticMarkup(<SecretValue label="K" value="a" />);
    const long = renderToStaticMarkup(
      <SecretValue label="K" value={"x".repeat(200)} />,
    );
    expect(short).toBe(long.replace(/x{200}/g, "a"));
    expect(long).not.toContain("xxxx");
  });
});
