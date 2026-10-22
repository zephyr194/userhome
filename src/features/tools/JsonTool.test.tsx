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
import { afterEach, describe, expect, it } from "vitest";
import { JsonTool } from "./JsonTool";

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
});
