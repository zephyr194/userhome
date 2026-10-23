// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { CaddyPage } from "./CaddyPage";
import { CaddyExamplesDialog } from "./CaddyExamplesDialog";
import { CaddyRulesEditor } from "./CaddyRulesEditor";
import { CaddyRunView } from "./CaddyRunPanel";
import { createIdSource, mapIssuesToFields, newSiteDraft } from "./caddyRulesModel";
import { initialLogView } from "./caddyRunModel";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

vi.mock("../../ipc/caddy", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../ipc/caddy")>();
  const pending = () => new Promise<never>(() => undefined);
  return {
    ...original,
    caddyDetect: pending,
    caddyLoadRules: pending,
    caddyPreview: pending,
    caddySave: pending,
    caddyTlsStatus: pending,
    caddyLoadRaw: pending,
    caddyStatus: pending,
    caddyWorkdirStatus: () =>
      Promise.resolve({
        authorized: undefined,
        defaultDisplayPath: "/Users/example/UserHome/caddy",
        legacyDataPresent: false,
      }),
  };
});

function renderInEnglish(ui: React.ReactElement) {
  return render(<LocaleProvider preference="en">{ui}</LocaleProvider>);
}

function expectNoCjk(text: string) {
  expect(CJK_PATTERN.test(text)).toBe(false);
}

describe("Caddy page in English", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the working folder gate, detection and rules placeholders without Chinese", async () => {
    const { container } = renderInEnglish(<CaddyPage />);

    expect(await screen.findByText("Use /Users/example/UserHome/caddy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose another folder…" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Working folder" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Caddy detection" })).toBeTruthy();
    expect(screen.getByText("Choose a working folder first before rules can be read or saved.")).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });
});

describe("Caddy sections in English", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the rules editor with directive labels and actions in English", () => {
    const ids = createIdSource();
    const sites = [newSiteDraft(ids)];
    const { container } = renderInEnglish(
      <CaddyRulesEditor
        sites={sites}
        localErrors={{}}
        mapped={mapIssuesToFields([])}
        exposedSites={new Set()}
        ids={ids}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Proxy rules" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add site" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Examples" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Add directive" })).toBeTruthy();
    expect(screen.getAllByText("Listen host").length).toBeGreaterThan(0);
    expectNoCjk(container.textContent ?? "");
  });

  it("renders the run view status and actions in English", () => {
    const { container } = renderInEnglish(
      <CaddyRunView
        source="RULES"
        status={{ state: "RUNNING", message: "Caddy is running.", diagnostics: [], applied: "PENDING" }}
        busy={false}
        logs={initialLogView(undefined)}
        paused={false}
        onPrepare={() => undefined}
        onStart={() => undefined}
        onCancelSummary={() => undefined}
        onStop={() => undefined}
        onPauseChange={() => undefined}
        onApply={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Run (own instance)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview before starting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to running instance" })).toBeTruthy();
    expect(screen.getByText("● Running")).toBeTruthy();
    expect(screen.getByText(/Not applied/)).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });

  it("renders the examples dialog with English titles and copy", () => {
    renderInEnglish(<CaddyExamplesDialog open onClose={() => undefined} />);

    expect(screen.getByRole("tab", { name: /^Local reverse proxy/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy example" })).toBeTruthy();
    expectNoCjk(document.body.textContent ?? "");
  });
});
