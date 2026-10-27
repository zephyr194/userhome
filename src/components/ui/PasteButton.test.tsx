// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteButton } from "./PasteButton";

const UNREADABLE = "无法读取粘贴板：请在输入框中按 ⌘V 粘贴。";
const EMPTY = "粘贴板里没有文本。";

function stubClipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText },
  });
}

function removeClipboard() {
  Reflect.deleteProperty(navigator, "clipboard");
}

function liveRegion(container: HTMLElement) {
  const region = container.querySelector('[aria-live="polite"]');
  if (!(region instanceof HTMLElement)) throw new Error("missing live region");
  return region;
}

afterEach(() => {
  cleanup();
  removeClipboard();
  vi.restoreAllMocks();
});

describe("PasteButton", () => {
  it("renders a small secondary button with the full label and a polite live region", () => {
    const markup = renderToStaticMarkup(<PasteButton onPaste={() => {}} />);
    expect(markup).toContain("读取粘贴板");
    expect(markup).toContain("min-h-control-sm");
    expect(markup).toContain("border-button-border");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });

  it("stays disabled when the owning field is locked", () => {
    const markup = renderToStaticMarkup(<PasteButton disabled onPaste={() => {}} />);
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("passes the clipboard text to onPaste and shows no notice on success", async () => {
    stubClipboard(() => Promise.resolve("第一行\n第二行"));
    const onPaste = vi.fn();
    const { container } = render(<PasteButton onPaste={onPaste} />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(onPaste).toHaveBeenCalledWith("第一行\n第二行"));
    expect(liveRegion(container).textContent).toBe("");
  });

  it("explains how to paste manually when the read is rejected", async () => {
    stubClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    const onPaste = vi.fn();
    const { container } = render(<PasteButton onPaste={onPaste} />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(liveRegion(container).textContent).toBe(UNREADABLE));
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("explains how to paste manually when the clipboard API is unavailable", async () => {
    removeClipboard();
    const onPaste = vi.fn();
    const { container } = render(<PasteButton onPaste={onPaste} />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(liveRegion(container).textContent).toBe(UNREADABLE));
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("reports an empty clipboard and leaves the field untouched", async () => {
    stubClipboard(() => Promise.resolve(""));
    const onPaste = vi.fn();
    const { container } = render(<PasteButton onPaste={onPaste} />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(liveRegion(container).textContent).toBe(EMPTY));
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("disables the button while the clipboard is being read", async () => {
    let resolveRead: (text: string) => void = () => {};
    stubClipboard(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const onPaste = vi.fn();
    render(<PasteButton onPaste={onPaste} />);
    const button = screen.getByRole("button", { name: "读取粘贴板" });

    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveRead("abc");
    });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(onPaste).toHaveBeenCalledWith("abc");
  });

  it("starts only one read while the first is still running", async () => {
    let resolveRead: (text: string) => void = () => {};
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    stubClipboard(readText);
    const onPaste = vi.fn();
    render(<PasteButton onPaste={onPaste} />);
    const button = screen.getByRole("button", { name: "读取粘贴板" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(readText).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead("abc");
    });
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("drops a read that finishes after unmounting, without a state update", async () => {
    let resolveRead: (text: string) => void = () => {};
    stubClipboard(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPaste = vi.fn();
    const { unmount } = render(<PasteButton onPaste={onPaste} />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));
    unmount();
    await act(async () => {
      resolveRead("abc");
    });

    expect(onPaste).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("clears an earlier notice once a later read succeeds", async () => {
    const readText = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce("ok");
    stubClipboard(readText);
    const onPaste = vi.fn();
    const { container } = render(<PasteButton onPaste={onPaste} />);
    const button = screen.getByRole("button", { name: "读取粘贴板" });

    fireEvent.click(button);
    await waitFor(() => expect(liveRegion(container).textContent).toBe(UNREADABLE));

    fireEvent.click(button);
    await waitFor(() => expect(onPaste).toHaveBeenCalledWith("ok"));
    expect(liveRegion(container).textContent).toBe("");
  });
});
