// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rtl = typeof import("@testing-library/react");

interface Handlers {
  detect: () => unknown;
  upgrade: () => unknown;
}

const OTHER_TOOLS = [
  ["codex-cli", "Codex CLI"],
  ["gemini-cli", "Gemini CLI"],
  ["copilot-cli", "GitHub Copilot CLI"],
] as const;

const HOMEBREW = { type: "homebrew", kind: "FORMULA", package: "claude-code" };

function claudeWire(installSource: unknown, installStatus = "found"): Record<string, unknown> {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    installStatus,
    installSource,
    displayPath: installStatus === "found" ? "/opt/homebrew/bin/claude" : null,
    invalidReason: null,
    version: installStatus === "found" ? "2.1.0" : null,
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://code.claude.com/docs/en/settings"],
    verificationNote: "待核验",
  };
}

function reportWire(claude: Record<string, unknown>) {
  return {
    tools: [
      claude,
      ...OTHER_TOOLS.map(([id, displayName]) => ({
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
    ],
  };
}

let rtl: Rtl;
let AiConfigPage: typeof import("./AiConfigPage").AiConfigPage;
let detectCalls: number;

async function freshPage(): Promise<void> {
  vi.resetModules();
  rtl = await import("@testing-library/react");
  ({ AiConfigPage } = await import("./AiConfigPage"));
}

function mockBackend(handlers: Handlers): void {
  detectCalls = 0;
  mockIPC((command) => {
    if (command === "ai_config_detect") {
      detectCalls += 1;
      return handlers.detect();
    }
    if (command === "ai_config_brew_upgrade") return handlers.upgrade();
    throw new Error(`unexpected command ${command}`);
  });
}

async function renderPage(claude: Record<string, unknown>, upgrade: () => unknown = () => null) {
  mockBackend({ detect: () => reportWire(claude), upgrade });
  rtl.render(<AiConfigPage />);
  await rtl.screen.findByRole("list", { name: "AI 工具列表" });
}

function updateButton() {
  return rtl.screen.queryByRole("button", { name: "更新" });
}

async function confirmUpdate(): Promise<void> {
  rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "更新" }));
  const dialog = await rtl.screen.findByRole("dialog");
  rtl.fireEvent.click(rtl.within(dialog).getByRole("button", { name: "开始更新" }));
}

beforeEach(async () => {
  await freshPage();
});

afterEach(() => {
  rtl.cleanup();
  clearMocks();
});

describe("Homebrew 安装方式与更新", () => {
  it("显示 formula 安装方式和更新按钮", async () => {
    await renderPage(claudeWire(HOMEBREW));

    expect(rtl.screen.getByText("安装方式")).toBeTruthy();
    expect(rtl.screen.getByText("Homebrew（formula claude-code）")).toBeTruthy();
    expect(updateButton()).not.toBeNull();
  });

  it("未安装的工具不显示安装方式", async () => {
    await renderPage(claudeWire(null, "missing"));

    expect(rtl.screen.queryByText("安装方式")).toBeNull();
    expect(updateButton()).toBeNull();
  });

  it("直接安装显示说明且没有更新按钮", async () => {
    await renderPage(claudeWire({ type: "direct" }));

    expect(rtl.screen.getByText("直接安装")).toBeTruthy();
    expect(updateButton()).toBeNull();
  });

  it("点击更新先弹出确认，取消时不执行", async () => {
    const upgrade = vi.fn(() => null);
    await renderPage(claudeWire(HOMEBREW), upgrade);

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "更新" }));
    const dialog = await rtl.screen.findByRole("dialog");

    expect(
      rtl.within(dialog).getByText(
        "将运行 brew upgrade claude-code，可能需要几分钟，期间请不要关闭应用。",
      ),
    ).toBeTruthy();
    rtl.fireEvent.click(rtl.within(dialog).getByRole("button", { name: "取消" }));
    expect(rtl.screen.queryByRole("dialog")).toBeNull();
    expect(upgrade).not.toHaveBeenCalled();
  });

  it("确认后禁用按钮，成功更新后显示新版本并重新检测", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    await renderPage(claudeWire(HOMEBREW), () => pending);

    await confirmUpdate();
    const running = await rtl.screen.findByRole("button", { name: "正在更新…" });
    expect((running as HTMLButtonElement).disabled).toBe(true);

    finish({ status: "UPGRADED", message: "已更新到 2.2.0。", newVersion: "2.2.0" });

    expect(await rtl.screen.findByText("已更新到 2.2.0")).toBeTruthy();
    await rtl.waitFor(() => expect(detectCalls).toBe(2));
  });

  it("已是最新版本时显示提示并重新检测", async () => {
    await renderPage(claudeWire(HOMEBREW), () => ({
      status: "ALREADY_CURRENT",
      message: "已是最新版本（2.1.0）。",
      newVersion: "2.1.0",
    }));

    await confirmUpdate();

    expect(await rtl.screen.findByText("已是最新版本")).toBeTruthy();
    await rtl.waitFor(() => expect(detectCalls).toBe(2));
  });

  it("失败时显示原因与重试，且不重新检测", async () => {
    await renderPage(claudeWire(HOMEBREW), () => ({
      status: "FAILED",
      message: "brew upgrade claude-code 未能完成（退出码 1）。\n可稍后重试。",
      newVersion: null,
    }));

    await confirmUpdate();

    const message = await rtl.screen.findByText(/未能完成（退出码 1）/);
    expect(message.getAttribute("role")).toBe("alert");
    expect(rtl.within(message.parentElement as HTMLElement).getByRole("button", { name: "重试" })).toBeTruthy();
    expect(detectCalls).toBe(1);
  });

  it("调用失败时显示后端给出的原因", async () => {
    await renderPage(claudeWire(HOMEBREW), () =>
      Promise.reject({
        code: "NOT_FOUND",
        message: "没有找到 Homebrew，无法更新。",
        retryable: false,
      }),
    );

    await confirmUpdate();

    const message = await rtl.screen.findByText(/没有找到 Homebrew，无法更新。/);
    expect(message.getAttribute("role")).toBe("alert");
    expect(detectCalls).toBe(1);
  });
});
