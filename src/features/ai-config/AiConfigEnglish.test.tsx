// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rtl = typeof import("@testing-library/react");

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u9fff\uf900-\uffef]/;

const TOOL_IDS = [
  ["claude-code", "Claude Code"],
  ["codex-cli", "Codex CLI"],
  ["gemini-cli", "Gemini CLI"],
  ["copilot-cli", "GitHub Copilot CLI"],
] as const;

function reportWire(): Record<string, unknown> {
  return {
    tools: TOOL_IDS.map(([id, displayName]) => ({
      id,
      displayName,
      installStatus: "missing",
      installSource: null,
      displayPath: null,
      invalidReason: null,
      version: null,
      configPresence: "notRegistered",
      configDisplayPath: null,
      references: ["https://example.com/docs"],
      verificationNote: "Not verified yet",
    })),
  };
}

let rtl: Rtl;
let AiConfigPage: typeof import("./AiConfigPage").AiConfigPage;
let LocaleProvider: typeof import("../../i18n/LocaleProvider").LocaleProvider;

async function freshPage(): Promise<void> {
  vi.resetModules();
  rtl = await import("@testing-library/react");
  ({ AiConfigPage } = await import("./AiConfigPage"));
  ({ LocaleProvider } = await import("../../i18n/LocaleProvider"));
}

function mockDetection(): void {
  mockIPC((command) => {
    if (command !== "ai_config_detect") throw new Error(`unexpected command ${command}`);
    return reportWire();
  });
}

function renderInEnglish() {
  return rtl.render(
    <LocaleProvider preference="en">
      <AiConfigPage />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  await freshPage();
  mockDetection();
});

afterEach(() => {
  rtl.cleanup();
  clearMocks();
});

describe("AI tools page in English", () => {
  it("renders the tool list and its intro without Chinese characters", async () => {
    const { container } = renderInEnglish();

    const list = await rtl.screen.findByRole("list", { name: "AI tool list" });
    expect(list).toBeTruthy();
    expect(rtl.screen.getByRole("heading", { name: "Tool list" })).toBeTruthy();
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });

  it("renders the search control and placeholder in English", async () => {
    const { container } = renderInEnglish();
    await rtl.screen.findByRole("list", { name: "AI tool list" });

    expect(rtl.screen.getByRole("textbox", { name: "Search settings" })).toBeTruthy();
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });
});
