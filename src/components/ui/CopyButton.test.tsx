// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("copies the value and confirms beside the button", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<CopyButton label="复制" value="sk-test-123" />);

    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect((await screen.findByRole("status")).textContent).toBe("已复制");
    expect(writeText).toHaveBeenCalledWith("sk-test-123");
  });

  it("says the copy failed in the danger tone when the clipboard rejects", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyButton label="复制" value="sk-test-123" />);

    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("复制失败");
    expect(status.className).toContain("text-danger");
  });
});
