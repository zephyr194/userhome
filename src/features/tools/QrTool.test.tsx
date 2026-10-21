import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QrTool } from "./QrTool";

describe("QrTool", () => {
  it("renders the idle state with no image and export unavailable", () => {
    const html = renderToStaticMarkup(<QrTool />);
    expect(html).toContain("二维码生成");
    expect(html).toContain("输入内容后会在这里生成二维码。");
    expect(html).not.toContain("data:image/png");
    expect(html).not.toContain("<script");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>导出 PNG/);
  });
});
