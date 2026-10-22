import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { decodeClaudeTerminalOpened, openClaudeCommandInTerminal } from "./aiConfig";

afterEach(() => clearMocks());

const REQUEST = {
  flags: [{ id: "--print", value: null }],
  env: [],
  acknowledgedRisks: [],
  detectedVersion: null,
};

describe("decodeClaudeTerminalOpened", () => {
  it("accepts only the empty success response", () => {
    expect(() => decodeClaudeTerminalOpened(null)).not.toThrow();
  });

  it.each([
    ["an object", { text: "claude" }],
    ["a string", "opened"],
    ["undefined", undefined],
    ["false", false],
  ])("refuses %s", (_label, payload) => {
    expect(() => decodeClaudeTerminalOpened(payload)).toThrow();
  });
});

describe("openClaudeCommandInTerminal", () => {
  it("sends only the structured choices, never a command string", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return null;
    });

    await openClaudeCommandInTerminal(REQUEST);

    expect(captured?.command).toBe("ai_config_claude_open_in_terminal");
    expect(captured?.payload).toEqual({
      input: { toolId: "claude-code", request: REQUEST, projectGrantId: null },
    });
  });

  it("fails closed when the backend returns an unexpected payload", async () => {
    mockIPC(() => ({ text: "claude --print" }));

    await expect(openClaudeCommandInTerminal(REQUEST)).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
