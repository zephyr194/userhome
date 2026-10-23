// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "./LocaleProvider";
import { useLocale, useT } from "./useLocale";

function Probe() {
  const t = useT();
  const locale = useLocale();
  return <p data-testid="probe">{`${locale}:${t("common.refresh")}`}</p>;
}

describe("LocaleProvider", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.lang = "";
  });

  it("renders Chinese messages by default", () => {
    render(
      <LocaleProvider preference="zh-CN">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("zh-CN:刷新");
  });

  it("updates messages and the document language when the preference changes", () => {
    const { rerender } = render(
      <LocaleProvider preference="zh-CN">
        <Probe />
      </LocaleProvider>,
    );

    rerender(
      <LocaleProvider preference="en">
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("probe").textContent).toBe("en:Refresh");
    expect(document.documentElement.lang).toBe("en");
  });

  it("follows a Chinese system language for the system preference", () => {
    vi.stubGlobal("navigator", { language: "zh-Hans-CN" });
    render(
      <LocaleProvider preference="system">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("zh-CN:刷新");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("falls back to English for the system preference on other languages", () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    render(
      <LocaleProvider preference="system">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("en:Refresh");
  });
});
