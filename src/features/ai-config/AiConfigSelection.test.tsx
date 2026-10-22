import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiToolReport } from "../../ipc/aiConfig";
import { isTextVisible } from "../../test/markupVisibility";
import { AiConfigView } from "./AiConfigView";
import type { AiConfigState } from "./aiConfigModel";

const noop = () => undefined;

function tool(id: AiToolReport["id"], displayName: string): AiToolReport {
  return {
    id,
    displayName,
    installStatus: "missing",
    displayPath: null,
    invalidReason: null,
    version: null,
    configPresence: "notRegistered",
    references: [],
    verificationNote: "待核验",
  };
}

const READY: AiConfigState = {
  status: "ready",
  report: {
    tools: [
      tool("claude-code", "Claude Code"),
      tool("codex-cli", "Codex CLI"),
      tool("gemini-cli", "Gemini CLI"),
      tool("copilot-cli", "GitHub Copilot CLI"),
    ],
  },
};

function render(selectedToolId: string): string {
  return renderToStaticMarkup(
    <AiConfigView
      state={READY}
      selectedToolId={selectedToolId}
      onSelectTool={noop}
      onRefresh={noop}
      claudePanel={<p>设置占位</p>}
    />,
  );
}

describe("AI 工具选择", () => {
  it("marks the tool named by the selection as current in the list", () => {
    const markup = render("codex-cli");
    expect(markup).toMatch(/aria-current="true"[^>]*>(?:(?!<\/button>).)*Codex CLI/);
  });

  it("shows the Claude Code panels only while Claude Code is selected", () => {
    expect(isTextVisible(render("claude-code"), "设置占位")).toBe(true);
    expect(isTextVisible(render("codex-cli"), "设置占位")).toBe(false);
  });

  it("shows the card of the selected tool alone on the right", () => {
    const markup = render("gemini-cli");
    expect(markup).toContain('id="ai-tool-gemini-cli"');
    expect(markup).not.toContain('id="ai-tool-codex-cli"');
  });

  it("falls back to Claude Code for a selection the report no longer lists", () => {
    expect(isTextVisible(render("retired-tool"), "设置占位")).toBe(true);
  });
});
