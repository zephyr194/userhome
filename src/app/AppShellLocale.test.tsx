import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AppShell, QuitConfirmationDialog } from "./AppShell";
import type { ShellState } from "./shellState";
import { DEFAULT_USER_PREFERENCES } from "../ipc/settings";

const englishState: ShellState = {
  connection: { status: "loading" },
  discovery: { status: "loading" },
  preferences: {
    status: "ready",
    preferences: { ...DEFAULT_USER_PREFERENCES, language: "en" },
  },
  recentOperation: { status: "empty" },
  refresh: { status: "idle" },
};

function renderEnglishShell(): string {
  return renderToStaticMarkup(
    <AppShell
      onAppearanceChange={() => Promise.resolve()}
      onRefresh={() => undefined}
      state={englishState}
    />,
  );
}

describe("AppShell in English", () => {
  it("shows English navigation group names and route labels", () => {
    const markup = renderEnglishShell();
    expect(markup).toContain("System tools");
    expect(markup).toContain("Support");
    expect(markup).toContain("Environment variables");
    expect(markup).toContain("Connecting");
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain("Skip to main content");
    expect(markup).not.toContain("主导航");
    expect(markup).not.toContain("系统工具");
  });

  it("keeps the sidebar labels free of truncation classes", () => {
    const sidebar = renderEnglishShell().match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(sidebar).toContain("navigation-rail__label");
    expect(sidebar).not.toMatch(/truncate|text-ellipsis|ellipsis/);
  });

  it("lets sidebar rows grow to fit wrapped English labels", () => {
    const css = readFileSync(resolve(__dirname, "../styles/global.css"), "utf8");
    const block = css.slice(
      css.indexOf("/* r8-i18n-shell */"),
      css.indexOf("/* /r8-i18n-shell */"),
    );
    expect(block).toContain("height: auto;");
    expect(block).toContain("min-height: var(--app-row-height-compact);");
    expect(block).not.toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe("QuitConfirmationDialog in English", () => {
  it("uses the plural form for the number of running processes", () => {
    const render = (processCount: number) =>
      renderToStaticMarkup(
        <LocaleProvider preference="en">
          <QuitConfirmationDialog
            onCancel={() => undefined}
            onConfirm={() => undefined}
            prompt={{ phase: "asking", processCount }}
          />
        </LocaleProvider>,
      );

    expect(render(1)).toContain("UserHome still has 1 process started by it running.");
    expect(render(3)).toContain("UserHome still has 3 processes started by it running.");
    expect(render(3)).toContain("Stop and quit");
    expect(render(3)).toContain("Cancel quit");
  });
});
