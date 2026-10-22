// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemToolsPage } from "./SystemToolsPage";
import { SYSTEM_TOOL_CARDS } from "./toolCards";

describe("系统工具卡片页", () => {
  afterEach(() => {
    cleanup();
  });

  it("只列出硬编码的 Caddy 卡片，名称与说明与清单一致", () => {
    expect(SYSTEM_TOOL_CARDS.map((tool) => tool.name)).toEqual(["Caddy"]);
    const markup = renderToStaticMarkup(<SystemToolsPage onOpen={() => undefined} />);
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('class="system-tool-card__name">Caddy</span>');
    expect(markup).toContain("检测 Caddy 并编辑本机反向代理规则。");
    expect(markup).toContain('class="system-tool-card__action">打开</span>');
  });

  it("卡片不展示任何运行状态，也不读取后端数据", () => {
    const markup = renderToStaticMarkup(<SystemToolsPage onOpen={() => undefined} />);
    expect(markup).not.toMatch(/运行中|已停止|未检测|状态/);
  });

  it("点击整张卡片时以 caddy 调用打开", () => {
    const onOpen = vi.fn();
    render(<SystemToolsPage onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /^Caddy/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("caddy");
  });
});
