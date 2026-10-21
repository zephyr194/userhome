import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { XmlTool } from "./XmlTool";

describe("XmlTool", () => {
  it("shows the modes, the limits and an idle result", () => {
    const html = renderToStaticMarkup(<XmlTool />);
    expect(html).toContain("XML 格式化");
    expect(html).toContain("缩进 2 空格");
    expect(html).toContain("缩进 4 空格");
    expect(html).toContain("不解析 DTD");
    expect(html).toContain("结果会显示在这里。");
    expect(html).not.toContain("复制结果");
  });

  it("offers no minify mode, since whitespace may be significant", () => {
    const html = renderToStaticMarkup(<XmlTool />);
    expect(html).not.toContain("压缩");
  });

  it("renders no result text, links or scripts before a request", () => {
    const html = renderToStaticMarkup(<XmlTool />);
    expect(html).not.toContain('aria-label="格式化结果"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<script");
  });
});
