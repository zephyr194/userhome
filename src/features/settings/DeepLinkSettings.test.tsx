// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listDeepLinks } from "../../app/deepLink";
import { translate } from "../../i18n";
import { DeepLinkSettings } from "./DeepLinkSettings";

const ZSH_LINK = "userhome://open/environment?section=zsh";
const ZSH_LABEL = translate("zh-CN", "route.section.zsh");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function rowFor(link: string): HTMLElement {
  const row = screen.getByText(link).closest("tr");
  if (!row) throw new Error(`no row for ${link}`);
  return row;
}

describe("DeepLinkSettings", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("lists every link the app accepts, one table per page", () => {
    const pages = listDeepLinks();
    const total = pages.reduce((count, page) => count + page.rows.length, 0);
    render(<DeepLinkSettings />);

    expect(screen.getAllByRole("table")).toHaveLength(pages.length);
    expect(screen.getAllByRole("row")).toHaveLength(total);
    for (const page of pages) {
      for (const row of page.rows) {
        expect(screen.getByText(row.link)).toBeTruthy();
      }
    }
  });

  it("states that links work only in the installed app, in text rather than colour alone", () => {
    render(<DeepLinkSettings />);
    expect(screen.getByText("仅安装后可用")).toBeTruthy();
    expect(screen.getByText(/开发运行（tauri dev）时系统不会注册这个链接/)).toBeTruthy();
  });

  it("copies one link and confirms beside that row only", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<DeepLinkSettings />);

    fireEvent.click(screen.getByRole("button", { name: `复制 ${ZSH_LABEL} 的链接` }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(ZSH_LINK);
    expect(within(rowFor(ZSH_LINK)).getByRole("status").textContent).toBe("已复制");
    expect(screen.getAllByRole("status").filter((node) => node.textContent !== "")).toHaveLength(1);
  });

  it("explains a failed copy on the row that failed", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<DeepLinkSettings />);

    fireEvent.click(screen.getByRole("button", { name: `复制 ${ZSH_LABEL} 的链接` }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(rowFor(ZSH_LINK)).getByRole("status").textContent).toBe("复制失败");
  });

  it("clears the confirmation after three seconds", async () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    render(<DeepLinkSettings />);

    fireEvent.click(screen.getByRole("button", { name: `复制 ${ZSH_LABEL} 的链接` }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(rowFor(ZSH_LINK)).getByRole("status").textContent).toBe("已复制");

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(within(rowFor(ZSH_LINK)).getByRole("status").textContent).toBe("已复制");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(within(rowFor(ZSH_LINK)).queryByRole("status")).toBeNull();
  });
});
