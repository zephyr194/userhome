import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodecTool } from "./CodecTool";

describe("CodecTool", () => {
  it("shows the algorithm, the direction and an idle result", () => {
    const html = renderToStaticMarkup(<CodecTool />);
    expect(html).toContain("文本编解码");
    expect(html).toContain("Base64");
    expect(html).toContain("编码");
    expect(html).toContain("结果会显示在这里。");
    expect(html).not.toContain("复制结果");
  });

  it("renders no result text, links or scripts before a request", () => {
    const html = renderToStaticMarkup(<CodecTool />);
    expect(html).not.toContain('aria-label="输出"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<script");
  });
});
