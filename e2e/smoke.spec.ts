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

    expect(await $(".titlebar__title > span").getText()).toBe("UserHome");
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
    expect(await dashboard.getText()).toContain("在线");
    const viewport = await browser.execute(() => ({
      appearance: document.documentElement.dataset.appearance,
      colorScheme: document.documentElement.style.colorScheme,
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportHeight: document.documentElement.clientHeight,
      viewportWidth: document.documentElement.clientWidth,
    }));
    const colorSchemeByAppearance: Record<string, string> = {
      system: "light dark",
      light: "light",
      dark: "dark",
    };
    const appearance = viewport.appearance ?? "";
    expect(["system", "light", "dark"]).toContain(appearance);
    expect(colorSchemeByAppearance[appearance]).toBe(viewport.colorScheme);
    // Persisted System delegates to the OS media query instead of forcing dark.
    if (viewport.appearance === "system") {
      expect(viewport.colorScheme).toBe("light dark");
      expect(typeof viewport.prefersDark).toBe("boolean");
    }
    expect(viewport.documentHeight).toBeLessThanOrEqual(viewport.viewportHeight);
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);

    const assertDocumentFits = async (route: string) => {
      const dimensions = await browser.execute(() => ({
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        viewportHeight: document.documentElement.clientHeight,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.documentHeight).toBeLessThanOrEqual(
        dimensions.viewportHeight,
      );
      expect(dimensions.documentWidth).toBeLessThanOrEqual(
        dimensions.viewportWidth,
      );
      expect(route.length).toBeGreaterThan(0);
    };

    expect(await $("#user-directory-coverage-heading").getText()).toBe(
      "用户目录配置",
    );
    const dashboardText = await dashboard.getText();
    expect(dashboardText).toContain("四类计数守恒");
    await assertDocumentFits("dashboard");

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

    const localTab = await $("button[role='tab'][aria-selected='true']");
    expect(await localTab.getText()).toContain("本机识别");
    await $("aside[aria-label='本机识别项列表']").waitForDisplayed();
    await assertDocumentFits("applications-local");

    const catalogTab = await $("button[role='tab']*=全部目录");
    await catalogTab.click();
    await browser.waitUntil(
      async () => (await catalogTab.getAttribute("aria-selected")) === "true",
      { timeout: 5_000, timeoutMsg: "Catalog scope did not activate" },
    );
    const applicationList = await $(
      "aside[aria-label='应用与配置候选列表']",
    );
    await applicationList.waitForDisplayed();
    await browser.waitUntil(
      async () => {
        const entries = await applicationList.$$("[role='option']");
        return (await entries.length) === 50;
      },
      { timeout: 5_000, timeoutMsg: "Catalog page did not load 50 entries" },
    );
    expect(await applicationList.$$("[role='option']")).toHaveLength(50);
    expect(await $(".applications-workspace__header").getText()).toContain(
      "624",
    );
    expect(await applicationList.getText()).toContain("第 1 / 13 页");
    await assertDocumentFits("applications-catalog");

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
    await $("#brew-workspace").waitForDisplayed();
    const brewPanel = await $("#brew-workspace");
    await browser.waitUntil(
      async () => !(await brewPanel.getText()).includes("正在后台解析"),
      { timeout: 15_000, timeoutMsg: "Homebrew discovery did not settle" },
    );
    expect(await brewPanel.getText()).toMatch(
      /Formula \d+\s*Cask \d+|未检测到/,
    );
    await assertDocumentFits("homebrew");

    await $("a[href='#services']").click();
    await $("#services-heading").waitForDisplayed();
    expect(await $("section[aria-label='服务详情与操作']").isDisplayed()).toBe(
      true,
    );
    await assertDocumentFits("services");

    await $("a[href='#settings']").click();
    await $(".settings-pane").waitForDisplayed();
    expect(await $("[aria-label='设置分组']").isDisplayed()).toBe(true);
    expect(await $(".settings-pane__detail").isDisplayed()).toBe(true);
    await assertDocumentFits("settings");

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
