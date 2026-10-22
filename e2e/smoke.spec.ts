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
      ? { canvas: "#15191E", surface: "#1D2228", accent: "#F0A060" }
      : { canvas: "#EDF1F5", surface: "#F8FAFC", accent: "#B65C24" };
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

    await $("a[href='#services']").click();
    await $("#services-heading").waitForDisplayed();
    expect(await $("section[aria-label='任务详情']").isDisplayed()).toBe(
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

  it("lists the eight primary navigation entries and titles each page", async () => {
    const expectedRoutes = [
      { id: "dashboard", title: "概览" },
      { id: "services", title: "服务" },
      { id: "environment", title: "环境变量" },
      { id: "caddy", title: "Caddy" },
      { id: "appConfig", title: "应用配置" },
      { id: "aiConfig", title: "AI 配置" },
      { id: "tools", title: "工具集" },
      { id: "settings", title: "设置" },
    ];

    const navLinks = await $$("nav[aria-label='主导航'] a[href^='#']");
    const hrefs: (string | null)[] = [];
    for (const link of navLinks) {
      hrefs.push(await link.getAttribute("href"));
    }
    expect(hrefs.sort()).toEqual(
      expectedRoutes.map(({ id }) => `#${id}`).sort(),
    );

    for (const { id, title } of expectedRoutes) {
      await $(`nav[aria-label='主导航'] a[href='#${id}']`).click();
      await browser.waitUntil(
        async () =>
          (await $(".desktop-workspace__page-title").getText()) === title,
        {
          timeout: 5_000,
          timeoutMsg: `Route ${id} did not title the workspace "${title}"`,
        },
      );
    }
  });
});
