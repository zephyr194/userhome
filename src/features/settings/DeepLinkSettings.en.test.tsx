// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { DeepLinkSettings } from "./DeepLinkSettings";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("DeepLinkSettings in English", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("renders the section copy without Chinese characters", () => {
    const { container } = render(
      <LocaleProvider preference="en">
        <DeepLinkSettings />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { name: "Link opening" })).toBeTruthy();
    expect(screen.getByText("Installed app only")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Link examples" })).toBeTruthy();
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("confirms a copied example in English", async () => {
    stubClipboard(() => Promise.resolve());
    const { container } = render(
      <LocaleProvider preference="en">
        <DeepLinkSettings />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText("Copied: Open the zsh startup file for environment variables"),
    ).toBeTruthy();
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("explains a failed copy in English", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(
      <LocaleProvider preference="en">
        <DeepLinkSettings />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[1]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Copy failed. Select the link and copy it manually.",
    );
  });
});
