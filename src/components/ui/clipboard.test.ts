// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

function stubClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("writes the text and resolves true when the clipboard accepts it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);

    await expect(copyText("export PATH=/usr/bin")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("export PATH=/usr/bin");
  });

  it("resolves false when the clipboard rejects the write or is unavailable", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    await expect(copyText("value")).resolves.toBe(false);

    stubClipboard(undefined);
    await expect(copyText("value")).resolves.toBe(false);
  });
});
