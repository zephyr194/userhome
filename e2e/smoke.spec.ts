import { $, browser, expect } from "@wdio/globals";

describe("UserHome desktop smoke", () => {
  it("launches the macOS app and renders the main shell", async () => {
    expect(await browser.getTitle()).toBe("UserHome");

    const windowState = await browser.execute(async () => {
      const tauriWindow = window as Window & {
        __TAURI__: {
          core: {
            invoke<T>(
              command: string,
              args?: Record<string, unknown>,
            ): Promise<T>;
          };
        };
      };
      const [size, scaleFactor, resizable, maximizable, visible] =
        await Promise.all([
          tauriWindow.__TAURI__.core.invoke<{
            width: number;
            height: number;
          }>("plugin:window|inner_size", { label: "main" }),
          tauriWindow.__TAURI__.core.invoke<number>(
            "plugin:window|scale_factor",
            { label: "main" },
          ),
          tauriWindow.__TAURI__.core.invoke<boolean>(
            "plugin:window|is_resizable",
            { label: "main" },
          ),
          tauriWindow.__TAURI__.core.invoke<boolean>(
            "plugin:window|is_maximizable",
            { label: "main" },
          ),
          tauriWindow.__TAURI__.core.invoke<boolean>(
            "plugin:window|is_visible",
            { label: "main" },
          ),
        ]);

      return {
        width: Math.round(size.width / scaleFactor),
        height: Math.round(size.height / scaleFactor),
        resizable,
        maximizable,
        visible,
      };
    });
    expect(windowState.width).toBe(1120);
    expect(Math.abs(windowState.height - 720)).toBeLessThanOrEqual(1);
    expect(windowState.resizable).toBe(false);
    expect(windowState.maximizable).toBe(false);
    expect(windowState.visible).toBe(false);

    expect(await $(".brand").getText()).toBe("UserHome");
    expect(await $("nav[aria-label='主导航']").isDisplayed()).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>("a[href='#dashboard']")
        ?.click();
    });
    await $("#dashboard-heading").waitForDisplayed({ timeout: 5_000 });
    expect(await $(".titlebar__context").getText()).toBe("概览");
    const dashboard = await $("section[aria-labelledby='dashboard-heading']");
    expect(await dashboard.getText()).toContain("macOS");
    expect(await dashboard.getText()).toContain("架构");
    expect(await dashboard.getText()).toContain("已连接");

    const focusedHref = await browser.execute(() => {
      document
        .querySelector<HTMLElement>("a[href='#applications']")
        ?.focus();
      return (document.activeElement as HTMLAnchorElement)?.getAttribute("href");
    });
    expect(focusedHref).toBe("#applications");
    await browser.execute(() => {
      (document.activeElement as HTMLElement)?.click();
    });
    await $("#applications-heading").waitForDisplayed();
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLAnchorElement)?.getAttribute("href"),
      ),
    ).toBe("#applications");

    const applicationList = await $(
      "aside[aria-label='应用与配置候选列表']",
    );
    await applicationList.waitForDisplayed();
    const applicationEntries = await applicationList.$$("button");
    expect(applicationEntries.length).toBeGreaterThanOrEqual(26);
    expect(
      await applicationEntries.map((entry) => entry.getText()),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("GitHub Copilot"),
        expect.stringContaining("Caddy"),
        expect.stringContaining("Git"),
        expect.stringContaining("OpenSSH"),
        expect.stringContaining("Zsh"),
        expect.stringContaining("npm"),
        expect.stringContaining("Visual Studio Code"),
        expect.stringContaining("Cursor"),
        expect.stringContaining("Ghostty"),
        expect.stringContaining("Starship"),
        expect.stringContaining("tmux"),
        expect.stringContaining("Vim"),
        expect.stringContaining("Zed"),
        expect.stringContaining("Neovim"),
        expect.stringContaining("iTerm2"),
        expect.stringContaining("Claude"),
        expect.stringContaining("Codex"),
        expect.stringContaining("Gemini"),
        expect.stringContaining("Antigravity"),
        expect.stringContaining("Trae"),
        expect.stringContaining("Docker"),
        expect.stringContaining("OrbStack"),
        expect.stringContaining("Google Cloud CLI"),
        expect.stringContaining("Raycast"),
        expect.stringContaining("GitKraken CLI"),
        expect.stringContaining("Apifox"),
      ]),
    );
    expect(await $(".applications-workspace__header").getText()).toContain(
      "26 个 catalog 定义",
    );

    await $("a[href='#homebrew']").click();
    await $("#brew-heading").waitForDisplayed();
    const brewPanel = await $("section[aria-labelledby='brew-heading']");
    await browser.waitUntil(
      async () => !(await brewPanel.getText()).includes("正在后台解析"),
      { timeout: 15_000, timeoutMsg: "Homebrew discovery did not settle" },
    );
    expect(await brewPanel.getText()).toMatch(
      /Formula \d+\s*Cask \d+|未检测到/,
    );

    const refreshIds = await browser.execute(async () => {
      const tauriWindow = window as Window & {
        __TAURI__: {
          core: {
            invoke<T>(command: string): Promise<T>;
          };
        };
      };
      const [first, second] = await Promise.all([
        tauriWindow.__TAURI__.core.invoke<{ refreshId: string }>(
          "refresh_system_snapshot",
        ),
        tauriWindow.__TAURI__.core.invoke<{ refreshId: string }>(
          "refresh_system_snapshot",
        ),
      ]);
      return [first.refreshId, second.refreshId];
    });
    expect(refreshIds[0]).toBe(refreshIds[1]);

    const elevation = await browser.execute(async () => {
      const tauriWindow = window as Window & {
        __TAURI__: {
          core: {
            invoke<T>(command: string): Promise<T>;
          };
        };
      };
      return tauriWindow.__TAURI__.core.invoke<{
        operationId: string;
        resourceId: string;
        result: string;
      }>("e2e_fake_elevation_roundtrip");
    });
    expect(elevation).toEqual({
      operationId: "e2e-elevation-operation",
      resourceId: "caddy:system-caddyfile",
      result: "SUCCEEDED",
    });

    const helperStatus = await browser.execute(async () => {
      const tauriWindow = window as Window & {
        __TAURI__: {
          core: {
            invoke<T>(command: string): Promise<T>;
          };
        };
      };
      return tauriWindow.__TAURI__.core.invoke<{
        signed: boolean;
        available: boolean;
        state: string;
      }>("get_helper_status");
    });
    expect(helperStatus.signed).toBe(false);
    expect(helperStatus.available).toBe(false);
  });
});
