// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_LINK_FAILED } from "../../components/ui/clipboard";
import { parseDeepLink } from "../../app/deepLink";
import { DeepLinkSettings } from "./DeepLinkSettings";
import { DEEP_LINK_EXAMPLES } from "./deepLinkExamples";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("DeepLinkSettings", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("lists three examples that the app itself accepts as navigation", () => {
    expect(DEEP_LINK_EXAMPLES).toHaveLength(3);
    for (const example of DEEP_LINK_EXAMPLES) {
      expect(parseDeepLink(example.link), example.link).toBeDefined();
    }
  });

  it("states that links work only in the installed app, in text rather than colour alone", () => {
    render(<DeepLinkSettings />);
    expect(screen.getByText("仅安装后可用")).toBeTruthy();
    expect(screen.getByText(/开发运行（tauri dev）时系统不会注册这个链接/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "链接打开" })).toBeTruthy();
  });

  it("copies an example and confirms by name", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<DeepLinkSettings />);

    const [first] = screen.getAllByRole("button", { name: "复制" });
    fireEvent.click(first);
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("userhome://open/environment?section=zsh");
    expect(screen.getByText("已复制：打开环境变量的 zsh 启动文件")).toBeTruthy();
  });

  it("explains a failed copy and leaves the link visible to select", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<DeepLinkSettings />);

    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[1]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toBe(COPY_LINK_FAILED);
    expect(screen.getByText("userhome://open/caddy?section=rules")).toBeTruthy();
  });
});
