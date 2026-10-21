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
});
