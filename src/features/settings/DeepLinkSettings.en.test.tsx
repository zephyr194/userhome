// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { translate } from "../../i18n";
import { DeepLinkSettings } from "./DeepLinkSettings";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;
const ZSH_LINK = "userhome://open/environment?section=zsh";
const ZSH_LABEL = translate("en", "route.section.zsh");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function renderEnglish() {
  return render(
    <LocaleProvider preference="en">
      <DeepLinkSettings />
    </LocaleProvider>,
  );
}

describe("DeepLinkSettings in English", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("renders the copy and the list without Chinese characters", () => {
    const { container } = renderEnglish();

    expect(screen.getByText("Installed app only")).toBeTruthy();
    expect(screen.getByRole("region", { name: "All links" })).toBeTruthy();
    expect(screen.getByRole("table", { name: translate("en", "route.environment.label") })).toBeTruthy();
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("confirms a copied link in English on its own row", async () => {
    stubClipboard(() => Promise.resolve());
    const { container } = renderEnglish();

    fireEvent.click(screen.getByRole("button", { name: `Copy the ${ZSH_LABEL} link` }));
    await act(async () => {
      await Promise.resolve();
    });

    const row = screen.getByText(ZSH_LINK).closest("tr");
    expect(within(row as HTMLElement).getByRole("status").textContent).toBe("Copied");
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("explains a failed copy in English", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    renderEnglish();

    fireEvent.click(screen.getByRole("button", { name: `Copy the ${ZSH_LABEL} link` }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = screen.getByText(ZSH_LINK).closest("tr");
    expect(within(row as HTMLElement).getByRole("status").textContent).toBe("Copy failed");
  });
});
