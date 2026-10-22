// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render as renderInDom,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { XmlTool } from "./XmlTool";

describe("XmlTool", () => {
  afterEach(cleanup);

  it("shows the modes, the limits and an idle result", () => {
    const html = renderToStaticMarkup(<XmlTool />);
    expect(html).toContain("XML 格式化");
    expect(html).toContain("缩进 2 空格");
    expect(html).toContain("不解析 DTD");
    expect(html).toContain("结果会显示在这里。");
    expect(html).not.toContain("复制结果");
  });

  it("lists the indent modes once the output format is opened", () => {
    renderInDom(<XmlTool />);
    fireEvent.click(screen.getByRole("button", { name: "输出格式" }));
    expect(screen.getByRole("option", { name: "缩进 2 空格" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "缩进 4 空格" })).toBeTruthy();
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

  it("offers the input in an independent editor on an emphasised area", () => {
    const html = renderToStaticMarkup(<XmlTool />);
    expect(html).toContain('aria-label="在独立框中打开输入"');
    expect(html).toContain("field-emphasis");
  });
});
