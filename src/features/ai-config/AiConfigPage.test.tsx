// @vitest-environment jsdom
import { StrictMode } from "react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rtl = typeof import("@testing-library/react");

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
      verificationNote: "待核验",
    })),
  };
}

let rtl: Rtl;
let AiConfigPage: typeof import("./AiConfigPage").AiConfigPage;

/**
 * Each test gets a fresh module graph, so the in-memory detection cache and the
 * remembered tool start empty. React is loaded through the same fresh graph.
 */
async function freshPage(): Promise<void> {
  vi.resetModules();
  rtl = await import("@testing-library/react");
  ({ AiConfigPage } = await import("./AiConfigPage"));
}

function mockDetection(handler: (call: number) => unknown): () => number {
  let calls = 0;
  mockIPC((command) => {
    if (command !== "ai_config_detect") throw new Error(`unexpected command ${command}`);
    calls += 1;
    return handler(calls);
  });
  return () => calls;
}

function page(refreshId?: string) {
  return (
    <StrictMode>
      <AiConfigPage refreshId={refreshId} />
    </StrictMode>
  );
}

async function waitForList(): Promise<HTMLElement> {
  return rtl.screen.findByRole("list", { name: "AI 工具列表" });
}

beforeEach(async () => {
  await freshPage();
});

afterEach(() => {
  rtl.cleanup();
  clearMocks();
});

describe("AiConfigPage detection cache (r5-ai)", () => {
  it("detects once on the first visit, even under StrictMode, and keeps nothing in browser storage", async () => {
    const calls = mockDetection(() => reportWire());

    rtl.render(page());
    await waitForList();

    expect(calls()).toBe(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("shows the last report at once on a later visit without detecting again", async () => {
    const calls = mockDetection(() => reportWire());
    const first = rtl.render(page());
    await waitForList();
    first.unmount();

    rtl.render(page());

    expect(rtl.screen.getByRole("list", { name: "AI 工具列表" })).toBeTruthy();
    expect(rtl.screen.queryByText("正在检测 AI 工具……")).toBeNull();
    expect(calls()).toBe(1);
  });

  it("detects again only from the refresh action and keeps the shown tools while it runs", async () => {
    let release: () => void = () => undefined;
    const calls = mockDetection((call) =>
      call === 1
        ? reportWire()
        : new Promise((resolve) => {
            release = () => resolve(reportWire());
          }),
    );
    const view = rtl.render(page());
    await waitForList();

    view.rerender(page("refresh-1"));

    expect(calls()).toBe(2);
    expect(rtl.screen.getByText("正在刷新…")).toBeTruthy();
    expect(rtl.screen.getByRole("list", { name: "AI 工具列表" })).toBeTruthy();

    release();
    await rtl.waitFor(() => expect(rtl.screen.queryByText("正在刷新…")).toBeNull());
  });

  it("keeps the last report and explains a failed refresh", async () => {
    mockDetection((call) => {
      if (call === 1) return reportWire();
      throw { code: "INTERNAL", message: "检测命令暂时无法运行。", retryable: true };
    });
    const view = rtl.render(page());
    await waitForList();

    view.rerender(page("refresh-1"));

    await rtl.screen.findByText("刷新失败，仍显示上次读取的结果");
    expect(rtl.screen.getByText("检测命令暂时无法运行。")).toBeTruthy();
    expect(rtl.screen.getByRole("list", { name: "AI 工具列表" })).toBeTruthy();
  });

  it("opens on the tool picked during an earlier visit", async () => {
    mockDetection(() => reportWire());
    const first = rtl.render(page());
    await waitForList();
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /Codex CLI/ }));
    first.unmount();

    rtl.render(page());

    const list = rtl.screen.getByRole("list", { name: "AI 工具列表" });
    expect(list.querySelector('[aria-current="true"]')?.textContent).toContain("Codex CLI");
  });

  it("detects again when the app-wide refresh id changes, but not for the id seen on mount", async () => {
    const calls = mockDetection(() => reportWire());
    const view = rtl.render(<AiConfigPage refreshId="r1" />);
    await waitForList();
    expect(calls()).toBe(1);

    view.rerender(<AiConfigPage refreshId="r1" />);
    expect(calls()).toBe(1);

    view.rerender(<AiConfigPage refreshId="r2" />);
    await rtl.waitFor(() => expect(calls()).toBe(2));
  });
});
