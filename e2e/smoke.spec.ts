import { $, browser, expect } from "@wdio/globals";

describe("UserHome desktop smoke", () => {
  it("launches the macOS app and renders the main shell", async () => {
    expect(await browser.getTitle()).toBe("UserHome");

    const formProbe = await $("[data-testid='e2e-form-probe']");
    await formProbe.waitForDisplayed();
    const probeResult = await $("[data-testid='e2e-form-result']");
    const probeCheckbox = await formProbe.$("[role='checkbox']");
    const probeSecret = await formProbe.$("input[type='password']");

    await formProbe.$("button*=Probe submit").click();
    await browser.waitUntil(
      async () => (await probeResult.getText()).includes('"enabled":"on"'),
      { timeout: 2_000, timeoutMsg: "Default checkbox was not serialized" },
    );

    await probeCheckbox.click();
    await probeSecret.setValue("fixture-secret");
    await formProbe.$("button*=Probe submit").click();
    await browser.waitUntil(
      async () => {
        const result = await probeResult.getText();
        return (
          result.includes('"enabled":null') &&
          result.includes('"token":"fixture-secret"')
        );
      },
      { timeout: 2_000, timeoutMsg: "Unchecked/secret FormData was incorrect" },
    );

    await formProbe.$("button*=Probe reset").click();
    await browser.waitUntil(
      async () =>
        (await probeCheckbox.getAttribute("aria-checked")) === "true" &&
        (await probeSecret.getValue()) === "",
      { timeout: 2_000, timeoutMsg: "Headless form reset did not restore defaults" },
    );
    await formProbe.$("button*=Probe dismiss").click();
    await formProbe.waitForDisplayed({ reverse: true });

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
    await $("#user-directory-coverage-heading").waitForDisplayed({ timeout: 5_000 });
    expect(await $(".desktop-workspace__page-title").getText()).toBe("概览");
    const dashboard = await $("section[aria-label='概览']");
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
    const themeTokens = await browser.execute(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        canvas: styles.getPropertyValue("--app-canvas").trim().toUpperCase(),
        surface: styles.getPropertyValue("--app-surface").trim().toUpperCase(),
        accent: styles.getPropertyValue("--app-primary").trim().toUpperCase(),
      };
    });
    const expectedTheme = viewport.prefersDark
      ? { canvas: "#171512", surface: "#211E1A", accent: "#F0A060" }
      : { canvas: "#F5F1EA", surface: "#FCFAF6", accent: "#B65C24" };
    expect(themeTokens).toEqual(expectedTheme);

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
    await browser.waitUntil(
      async () => (await dashboard.getText()).includes("四类计数守恒"),
      {
        timeout: 10_000,
        timeoutMsg: "User-directory coverage did not settle",
      },
    );
    expect(await dashboard.getText()).toContain("四类计数守恒");
    await assertDocumentFits("dashboard");

    // Content navigation moves focus to main, while primary navigation keeps
    // its link focused.
    await $("button*=查看全部").click();
    await $("#applications-heading").waitForDisplayed();
    expect(
      await browser.execute(() => (document.activeElement as HTMLElement)?.id),
    ).toBe("main-content");

    const localTab = await $("button[role='tab']*=本机识别");
    const catalogTab = await $("button[role='tab']*=全部目录");
    expect(await localTab.getAttribute("aria-selected")).toBe("true");
    const localPanelId = await localTab.getAttribute("aria-controls");
    expect(localPanelId).toBeTruthy();
    expect(await $(`#${localPanelId}`).getAttribute("aria-labelledby")).toBe(
      await localTab.getAttribute("id"),
    );
    await localTab.click();
    await browser.keys("ArrowRight");
    await browser.waitUntil(
      async () => (await catalogTab.getAttribute("aria-selected")) === "true",
      { timeout: 5_000, timeoutMsg: "Catalog scope did not activate by keyboard" },
    );
    const catalogPanelId = await catalogTab.getAttribute("aria-controls");
    expect(catalogPanelId).toBeTruthy();
    expect(await $(`#${catalogPanelId}`).getAttribute("aria-labelledby")).toBe(
      await catalogTab.getAttribute("id"),
    );

    const applicationList = await $("aside[aria-label='应用与配置候选列表']");
    await applicationList.waitForDisplayed();
    await browser.waitUntil(
      async () => (await applicationList.$$(".applications-workspace__row").length) === 50,
      { timeout: 5_000, timeoutMsg: "Catalog page did not load 50 entries" },
    );
    const catalogRows = await applicationList.$$(".applications-workspace__row");
    expect(await catalogRows.length).toBe(50);
    await catalogRows[0].click();
    await browser.keys("ArrowDown");
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLElement)?.classList.contains(
          "applications-workspace__row",
        ),
      ),
    ).toBe(true);
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLElement)?.getAttribute("aria-current"),
      ),
    ).toBe("true");
    expect(await $(".applications-workspace__header").getText()).toContain("624");
    expect(await applicationList.getText()).toContain("第 1 / 13 页");
    await assertDocumentFits("applications-catalog");

    const applicationSearch = await $(
      ".applications-workspace__filters input[type='search']",
    );
    await applicationSearch.setValue("GitHub Copilot");
    await browser.waitUntil(
      async () => {
        const entries = await applicationList.$$(".applications-workspace__row");
        const values = await entries.map((entry) => entry.getText());
        return values.some((value) => value.includes("GitHub Copilot"));
      },
      { timeout: 5_000, timeoutMsg: "Catalog search did not settle" },
    );

    await $("a[href='#dashboard']").click();
    await $("#user-directory-coverage-heading").waitForDisplayed();
    const applicationsLink = await $("a[href='#applications']");
    await applicationsLink.click();
    await $("#applications-heading").waitForDisplayed();
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLAnchorElement)?.getAttribute("href"),
      ),
    ).toBe("#applications");

    await $("a[href='#homebrew']").click();
    await $("#brew-workspace").waitForDisplayed();
    const brewPanel = await $("#brew-workspace");
    await browser.waitUntil(
      async () => !(await brewPanel.getText()).includes("正在后台解析"),
      { timeout: 15_000, timeoutMsg: "Homebrew discovery did not settle" },
    );
    const brewText = await brewPanel.getText();
    expect(brewText).toMatch(
      /Formula \d+\s*Cask \d+|未检测到|错误：.+/,
    );
    expect(brewText).not.toContain("正在后台解析");
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
    const settingsTabs = await $$("[aria-label='设置分组'] [role='tab']");
    expect(await settingsTabs.length).toBe(7);
    await browser.execute((tab) => tab.focus(), settingsTabs[0]);
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLElement)?.getAttribute("data-group-id"),
      ),
    ).toBe("appearance");
    await browser.execute(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          code: "End",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await browser.waitUntil(
      async () =>
        (await $("[data-group-id='reset']").getAttribute("aria-selected")) ===
        "true",
      { timeout: 5_000, timeoutMsg: "Settings End key did not select reset" },
    );
    const resetTrigger = await $("button*=重置偏好…");
    await resetTrigger.click();
    const dialog = await $("[role='dialog']");
    await dialog.waitForDisplayed();
    expect(
      await browser.execute(() =>
        (document.activeElement as HTMLElement)?.hasAttribute("data-modal-cancel"),
      ),
    ).toBe(true);
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
    expect(
      await browser.execute(() => (document.activeElement as HTMLElement)?.textContent),
    ).toContain("重置偏好");
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
  });
});
