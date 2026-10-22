// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render as renderInDom,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonTool } from "./JsonTool";

const formatJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/textTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/textTools")>()),
  formatJson: formatJsonMock,
}));

describe("JsonTool", () => {
  afterEach(cleanup);

  it("offers the input in an independent editor on an emphasised area", () => {
    const html = renderToStaticMarkup(<JsonTool />);
    expect(html).toContain('aria-label="在独立框中打开输入"');
    expect(html).toContain("field-emphasis");
  });

  it("writes the editor draft back to the input", async () => {
    renderInDom(<JsonTool />);
    fireEvent.click(screen.getByRole("button", { name: "在独立框中打开输入" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "输入" }), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "完成" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "输入" });
    expect(input.value).toBe('{"a":1}');
  });

  it("titles the expanded editor with the tool name", async () => {
    renderInDom(<JsonTool />);
    fireEvent.click(screen.getByRole("button", { name: "在独立框中打开输入" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("JSON · 输入");
  });

  it("moves focus to the result heading after formatting", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    formatJsonMock.mockResolvedValue({ text: '{\n  "a": 1\n}', warnings: [], omittedWarnings: 0 });
    renderInDom(<JsonTool />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入" }), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "格式化" }));

    const heading = await screen.findByRole("heading", { name: "结果" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
