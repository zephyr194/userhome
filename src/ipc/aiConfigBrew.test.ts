import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  aiConfigBrewUpgrade,
  decodeAiBrewUpgradeOutcome,
  decodeAiConfigReport,
} from "./aiConfig";

afterEach(() => {
  clearMocks();
});

function toolWire(id: string, installSource: unknown): Record<string, unknown> {
  return {
    id,
    displayName: "Claude Code",
    installStatus: "found",
    installSource,
    displayPath: "~/.local/bin/claude",
    invalidReason: null,
    version: "2.1.0",
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://code.claude.com/docs/en/settings"],
    verificationNote: "待核验",
  };
}

function reportWith(installSource: unknown) {
  const ids = ["claude-code", "codex-cli", "gemini-cli", "copilot-cli"];
  return {
    tools: ids.map((id, index) =>
      toolWire(id, index === 0 ? installSource : null),
    ),
  };
}

describe("ToolReport installSource 解码", () => {
  it("解码 Homebrew formula 与 cask", () => {
    const formula = decodeAiConfigReport(
      reportWith({ type: "homebrew", kind: "FORMULA", package: "claude-code" }),
    );
    expect(formula.tools[0].installSource).toEqual({
      type: "homebrew",
      kind: "FORMULA",
      package: "claude-code",
    });

    const cask = decodeAiConfigReport(
      reportWith({ type: "homebrew", kind: "CASK", package: "gemini-cli" }),
    );
    expect(cask.tools[0].installSource).toEqual({
      type: "homebrew",
      kind: "CASK",
      package: "gemini-cli",
    });
  });

  it("解码直接安装与未安装", () => {
    expect(decodeAiConfigReport(reportWith({ type: "direct" })).tools[0].installSource).toEqual({
      type: "direct",
    });
    expect(decodeAiConfigReport(reportWith(null)).tools[0].installSource).toBeNull();
  });

  it("拒绝未知或畸形的来源，而不是静默当作 null", () => {
    const malformed: unknown[] = [
      { type: "npm", package: "claude" },
      { type: "homebrew", kind: "TAP", package: "claude-code" },
      { type: "homebrew", kind: "FORMULA", package: "--formula" },
      { type: "homebrew", kind: "FORMULA", package: "a;b" },
      { type: "homebrew", kind: "FORMULA", package: "x".repeat(129) },
      { type: "homebrew", kind: "FORMULA", package: "claude-code", extra: 1 },
      { type: "direct", path: "/Users/example/.local/bin/claude" },
      "homebrew",
      42,
    ];
    for (const source of malformed) {
      expect(() => decodeAiConfigReport(reportWith(source)), JSON.stringify(source)).toThrow();
    }
  });

  it("仍然要求 installSource 键存在", () => {
    const wire = reportWith(null);
    delete (wire.tools[0] as Record<string, unknown>).installSource;
    expect(() => decodeAiConfigReport(wire)).toThrow();
  });
});

describe("aiConfigBrewUpgrade", () => {
  it("把工具 id 作为 toolId 发送，并解码成功结果", async () => {
    let received: unknown;
    mockIPC((command, payload) => {
      if (command !== "ai_config_brew_upgrade") throw new Error(command);
      received = payload;
      return { status: "UPGRADED", message: "已更新到 2.2.0。", newVersion: "2.2.0" };
    });

    await expect(aiConfigBrewUpgrade("claude-code")).resolves.toEqual({
      status: "UPGRADED",
      message: "已更新到 2.2.0。",
      newVersion: "2.2.0",
    });
    expect(received).toEqual({ toolId: "claude-code" });
  });

  it("失败结果的 message 可以含换行，但不可含其他控制字符", () => {
    expect(
      decodeAiBrewUpgradeOutcome({
        status: "FAILED",
        message: "失败。\n最后的输出：\nError: download failed",
        newVersion: null,
      }),
    ).toEqual({
      status: "FAILED",
      message: "失败。\n最后的输出：\nError: download failed",
      newVersion: null,
    });
    expect(() =>
      decodeAiBrewUpgradeOutcome({ status: "FAILED", message: "坏\u001b[31m", newVersion: null }),
    ).toThrow();
  });

  it("拒绝未知状态、缺少字段与状态和版本不一致的结果", () => {
    expect(() =>
      decodeAiBrewUpgradeOutcome({ status: "PARTIAL", message: "x", newVersion: null }),
    ).toThrow();
    expect(() =>
      decodeAiBrewUpgradeOutcome({ status: "UPGRADED", message: "x" }),
    ).toThrow();
    expect(() =>
      decodeAiBrewUpgradeOutcome({ status: "UPGRADED", message: "x", newVersion: null }),
    ).toThrow();
    expect(() =>
      decodeAiBrewUpgradeOutcome({ status: "FAILED", message: "x", newVersion: "2.2.0" }),
    ).toThrow();
  });
});
