import { $, browser, expect } from "@wdio/globals";

describe("UserHome desktop smoke", () => {
  it("launches the macOS app and renders the main shell", async () => {
    expect(await browser.getTitle()).toBe("UserHome");
    expect(await $(".brand").getText()).toBe("UserHome");
    expect(await $("nav[aria-label='主导航']").isDisplayed()).toBe(true);
    expect(await $("#main-content h1").getText()).toBe("概览");
    expect(await $(".status-card").getText()).toContain("连接正常");
    await $(".summary-grid").waitForDisplayed({ timeout: 5_000 });
    expect(await $(".dashboard-panel").getText()).toContain("macOS");
    expect(await $(".dashboard-panel").getText()).toContain("架构");

    const focusedHref = await browser.execute(() => {
      document
        .querySelector<HTMLElement>("a[href='#applications']")
        ?.focus();
      return (document.activeElement as HTMLAnchorElement)?.getAttribute("href");
    });
    expect(focusedHref).toBe("#applications");
    await $("a[href='#applications']").click();
    await $("#applications-heading").waitForDisplayed();
    expect(
      await browser.execute(() => (document.activeElement as HTMLElement)?.id),
    ).toBe("main-content");

    const applicationCards = await $$(".application-card");
    expect(applicationCards).toHaveLength(6);
    expect(await applicationCards.map((card) => card.getText())).toEqual(
      expect.arrayContaining([
        expect.stringContaining("GitHub Copilot"),
        expect.stringContaining("Caddy"),
        expect.stringContaining("Git"),
        expect.stringContaining("OpenSSH"),
        expect.stringContaining("Zsh"),
        expect.stringContaining("npm"),
      ]),
    );
    expect(await $("#candidate-heading").isDisplayed()).toBe(true);

    await $("a[href='#homebrew']").click();
    await $("#brew-heading").waitForDisplayed();
    await browser.waitUntil(
      async () => !(await $(".brew-panel").getText()).includes("正在后台解析"),
      { timeout: 15_000, timeoutMsg: "Homebrew discovery did not settle" },
    );
    expect(await $(".brew-panel").getText()).toMatch(
      /Formula \d+ · Cask \d+|未检测到/,
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
