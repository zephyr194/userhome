import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolsPage } from "./ToolsPage";

describe("ToolsPage", () => {
  it("renders the tool switcher with JSON selected and an idle result", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("JSON 格式化");
    expect(html).toContain("结果会显示在这里。");
    expect(html).not.toContain("复制结果");
  });

  it("does not render any input or output text before a request", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).not.toContain('aria-label="格式化结果"');
    expect(html).not.toContain("未合并或删除");
    expect(html).not.toContain("<script");
  });

  it("offers the codec tool as a second tab beside JSON", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).toContain("编解码");
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });

  it("offers the XML tool as a tab between JSON and the codec", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html.indexOf(">XML<")).toBeGreaterThan(html.indexOf(">JSON<"));
    expect(html.indexOf(">XML<")).toBeLessThan(html.indexOf(">编解码<"));
  });

  it("offers the QR tool as the fourth tab after the codec", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).toContain(">二维码<");
    expect(html.indexOf(">二维码<")).toBeGreaterThan(html.indexOf(">编解码<"));
  });
});
