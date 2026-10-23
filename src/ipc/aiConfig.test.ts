import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { decodeAiConfigReport, detectAiConfig } from "./aiConfig";

afterEach(() => {
  clearMocks();
});

function toolWire(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    displayName: "Claude Code",
    installStatus: "missing",
    displayPath: null,
    invalidReason: null,
    version: null,
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://code.claude.com/docs/en/settings"],
    verificationNote: "环境变量与逐键合并规则仍待独立核验",
    ...overrides,
  };
}

function reportWire(overrides: Partial<Record<number, Record<string, unknown>>> = {}) {
  const ids = ["claude-code", "codex-cli", "gemini-cli", "copilot-cli"];
  return {
    tools: ids.map((id, index) => toolWire(id, overrides[index] ?? {})),
  };
}

const FOUND_CLAUDE = {
  installStatus: "found",
  displayPath: "/opt/homebrew/bin/claude",
  version: "2.1.0 (Claude Code)",
  configPresence: "found",
  configDisplayPath: "~/.claude/settings.json",
};

describe("decodeAiConfigReport", () => {
  it("decodes all four tools in fixed order with their facts kept separate", () => {
    const report = decodeAiConfigReport(
      reportWire({
        0: FOUND_CLAUDE,
        1: {
          installStatus: "invalid",
          displayPath: "~/.local/bin/codex",
          invalidReason: "outsideRoot",
          configPresence: "notRegistered",
          configDisplayPath: null,
        },
      }),
    );

    expect(report.tools.map((tool) => tool.id)).toEqual([
      "claude-code",
      "codex-cli",
      "gemini-cli",
      "copilot-cli",
    ]);
    expect(report.tools[0]).toMatchObject({
      installStatus: "found",
      version: "2.1.0 (Claude Code)",
      configPresence: "found",
      configDisplayPath: "~/.claude/settings.json",
    });
    expect(report.tools[1]).toMatchObject({
      installStatus: "invalid",
      invalidReason: "outsideRoot",
      version: null,
    });
  });

  it("accepts a missing tool that still carries its references", () => {
    const report = decodeAiConfigReport(reportWire());
    expect(report.tools[0].installStatus).toBe("missing");
    expect(report.tools[0].references).toHaveLength(1);
  });

  it("keeps the registered config path for Gemini CLI and Claude Code", () => {
    const report = decodeAiConfigReport(
      reportWire({
        0: FOUND_CLAUDE,
        2: {
          installStatus: "missing",
          configPresence: "notFound",
          configDisplayPath: "~/.gemini/settings.json",
        },
      }),
    );

    expect(report.tools[0].configDisplayPath).toBe("~/.claude/settings.json");
    expect(report.tools[2]).toMatchObject({
      configPresence: "notFound",
      configDisplayPath: "~/.gemini/settings.json",
    });
  });

  it.each([
    ["a non-object payload", []],
    ["a null payload", null],
    ["an extra top-level key", { ...reportWire(), candidates: [] }],
    ["three tools", { tools: reportWire().tools.slice(0, 3) }],
    ["tools out of order", { tools: [...reportWire().tools].reverse() }],
    ["an unknown tool id", reportWire({ 0: { id: "other-cli" } })],
    ["an unknown install status", reportWire({ 0: { installStatus: "installed" } })],
    ["a found tool without a path", reportWire({ 0: { ...FOUND_CLAUDE, displayPath: null } })],
    ["a found tool that also has an invalid reason", reportWire({ 0: { ...FOUND_CLAUDE, invalidReason: "outsideRoot" } })],
    ["an invalid tool without a reason", reportWire({ 0: { installStatus: "invalid", displayPath: "/x/claude" } })],
    ["a missing tool that carries a version", reportWire({ 0: { version: "2.1.0" } })],
    ["a missing tool that carries a path", reportWire({ 0: { displayPath: "/x/claude" } })],
    ["an unknown config presence", reportWire({ 0: { configPresence: "exists" } })],
    ["a config display path that is not text", reportWire({ 2: { configDisplayPath: 42 } })],
    ["a config display path that is empty", reportWire({ 2: { configDisplayPath: "   " } })],
    ["a version containing control characters", reportWire({ 0: { ...FOUND_CLAUDE, version: "2.1\u001b[31m" } })],
    ["an empty version", reportWire({ 0: { ...FOUND_CLAUDE, version: "   " } })],
    ["a non-https reference", reportWire({ 0: { references: ["http://example.com/docs"] } })],
    ["a reference with whitespace", reportWire({ 0: { references: ["https://example.com/a b"] } })],
    ["no references", reportWire({ 0: { references: [] } })],
    ["a missing verification note", reportWire({ 0: { verificationNote: undefined } })],
    ["a missing key", (() => {
      const wire = toolWire("claude-code") as Record<string, unknown>;
      delete wire.verificationNote;
      return { tools: [wire, ...reportWire().tools.slice(1)] };
    })()],
  ])("refuses %s", (_label, payload) => {
    expect(() => decodeAiConfigReport(payload)).toThrow();
  });
});

describe("detectAiConfig", () => {
  it("invokes the argument-free command and returns the decoded report", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return reportWire({ 0: FOUND_CLAUDE });
    });

    const report = await detectAiConfig();

    expect(captured?.command).toBe("ai_config_detect");
    expect(report.tools[0].installStatus).toBe("found");
  });

  it("fails closed when the backend returns a malformed payload", async () => {
    mockIPC(() => ({ tools: [] }));

    await expect(detectAiConfig()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("detectAiConfig cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("has no report to show before the first successful detection", async () => {
    const aiConfig = await import("./aiConfig");

    expect(aiConfig.lastAiConfigReport()).toBeUndefined();
  });

  it("shares one read between overlapping callers", async () => {
    const aiConfig = await import("./aiConfig");
    let calls = 0;
    mockIPC(() => {
      calls += 1;
      return reportWire({ 0: FOUND_CLAUDE });
    });

    const [first, second] = await Promise.all([aiConfig.detectAiConfig(), aiConfig.detectAiConfig()]);

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("remembers the last successful report in memory", async () => {
    const aiConfig = await import("./aiConfig");
    mockIPC(() => reportWire({ 0: FOUND_CLAUDE }));

    const report = await aiConfig.detectAiConfig();

    expect(aiConfig.lastAiConfigReport()).toEqual(report);
  });

  it("keeps the last good report when a later detection fails", async () => {
    const aiConfig = await import("./aiConfig");
    mockIPC(() => reportWire({ 0: FOUND_CLAUDE }));
    const good = await aiConfig.detectAiConfig();
    mockIPC(() => {
      throw new Error("backend unavailable");
    });

    await expect(aiConfig.detectAiConfig()).rejects.toMatchObject({ code: "INTERNAL" });

    expect(aiConfig.lastAiConfigReport()).toEqual(good);
  });

  it("runs a new read once the earlier one has settled", async () => {
    const aiConfig = await import("./aiConfig");
    let calls = 0;
    mockIPC(() => {
      calls += 1;
      return reportWire();
    });

    await aiConfig.detectAiConfig();
    await aiConfig.detectAiConfig();

    expect(calls).toBe(2);
  });
});
