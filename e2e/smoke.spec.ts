import { $, browser, expect } from "@wdio/globals";

describe("UserHome desktop smoke", () => {
  it("launches the macOS app and renders the main shell", async () => {
    expect(await browser.getTitle()).toBe("UserHome");

    const readWindowState = () => browser.execute(async () => {
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
    const windowState = await readWindowState();
    expect(windowState.width).toBe(1120);
    expect(windowState.height).toBe(720);
    expect(windowState.resizable).toBe(true);
    expect(windowState.maximizable).toBe(false);
    expect(windowState.visible).toBe(false);

    const initialRect = await browser.getWindowRect();
    try {
      for (const delta of [240, 0]) {
        await browser.setWindowRect(
          initialRect.x,
          initialRect.y,
          initialRect.width + delta,
          initialRect.height + delta,
        );
        const expectedWidth = 1120 + delta;
        const expectedHeight = 720 + delta;
        await browser.waitUntil(
          async () => {
            const state = await readWindowState();
            return (
              state.width === expectedWidth && state.height === expectedHeight
            );
          },
          { timeout: 5_000, timeoutMsg: "Native window resize did not settle" },
        );
        await browser.waitUntil(
          () =>
            browser.execute(
              (width, height) => {
                const root = document.documentElement;
                return (
                  root.clientWidth === width &&
                  root.clientHeight === height &&
                  root.scrollWidth <= width &&
                  root.scrollHeight <= height
                );
              },
              expectedWidth,
              expectedHeight,
            ),
          {
            timeout: 5_000,
            timeoutMsg: "Resized workspace overflowed its viewport",
          },
        );
        const resizedState = await readWindowState();
        expect(resizedState.resizable).toBe(true);
        expect(resizedState.maximizable).toBe(false);
        expect(resizedState.visible).toBe(false);
      }
    } finally {
      await browser.setWindowRect(
        initialRect.x,
        initialRect.y,
        initialRect.width,
        initialRect.height,
      );
    }

    expect(await $(".titlebar__title").getText()).toBe("UserHome");
    expect(await $("nav[aria-label='主导航']").isDisplayed()).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>("a[href='#dashboard']")
        ?.click();
    });
    await $("#dashboard-heading").waitForDisplayed({ timeout: 5_000 });
    expect(await $(".desktop-workspace__page-title").getText()).toBe("概览");
    const dashboard = await $("section[aria-labelledby='dashboard-heading']");
    expect(await dashboard.getText()).toContain("macOS");
    expect(await dashboard.getText()).toContain("架构");
    expect(await dashboard.getText()).toContain("已连接");
    const appearance = await browser.execute(() => ({
      value: document.documentElement.dataset.appearance,
      colorScheme: document.documentElement.style.colorScheme,
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    }));
    const colorSchemeByAppearance: Record<string, string> = {
      system: "light dark",
      light: "light",
      dark: "dark",
    };
    const persistedAppearance = appearance.value ?? "";
    expect(["system", "light", "dark"]).toContain(persistedAppearance);
    expect(colorSchemeByAppearance[persistedAppearance]).toBe(
      appearance.colorScheme,
    );
    if (appearance.value === "system") {
      expect(appearance.colorScheme).toBe("light dark");
      expect(typeof appearance.prefersDark).toBe("boolean");
    }

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
    expect(await applicationList.$$("[role='option']")).toHaveLength(50);
    expect(await $(".applications-workspace__header").getText()).toContain(
      "624 项",
    );
    expect(await applicationList.getText()).toContain("第 1 / 13 页");

    const applicationSearch = await $(
      ".applications-workspace__filters input[type='search']",
    );
    await applicationSearch.setValue("GitHub Copilot");
    await browser.waitUntil(
      async () => {
        const entries = await applicationList.$$("[role='option']");
        const values = await entries.map((entry) => entry.getText());
        return values.some((value) => value.includes("GitHub Copilot"));
      },
      { timeout: 5_000, timeoutMsg: "Catalog search did not settle" },
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
