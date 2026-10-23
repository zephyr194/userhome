// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { CopyPageLinkButton } from "./CopyPageLinkButton";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("CopyPageLinkButton in English", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("confirms a copied page link in English", async () => {
    stubClipboard(() => Promise.resolve());
    const { container } = render(
      <LocaleProvider preference="en">
        <CopyPageLinkButton link="userhome://open/caddy?section=rules" />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("status").textContent).toBe("Link copied");
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("explains a failed copy and shows the link in English", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const { container } = render(
      <LocaleProvider preference="en">
        <CopyPageLinkButton link="userhome://open/caddy?section=rules" />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Copy failed. Select the link and copy it manually.",
    );
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });
});
