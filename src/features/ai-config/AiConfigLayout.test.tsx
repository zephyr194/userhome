import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiToolReport } from "../../ipc/aiConfig";
import { AiConfigView } from "./AiConfigView";
import { selectedToolOf, showsClaudePanel, type AiConfigState } from "./aiConfigModel";

const noop = () => undefined;

function tool(overrides: Partial<AiToolReport>): AiToolReport {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    installStatus: "missing",
    displayPath: null,
    invalidReason: null,
    version: null,
    configPresence: "found",
    configDisplayPath: null,
    references: ["https://code.claude.com/docs/en/settings"],
    verificationNote: "环境变量与逐键合并规则仍待独立核验",
    ...overrides,
  };
}

const TOOLS: AiToolReport[] = [
  tool({
    installStatus: "found",
    displayPath: "/opt/homebrew/bin/claude",
    version: "2.1.0 (Claude Code)",
  }),
  tool({
    id: "codex-cli",
    displayName: "Codex CLI",
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://developers.openai.com/codex/config-basic"],
  }),
  tool({
    id: "gemini-cli",
    displayName: "Gemini CLI",
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://geminicli.com/docs/reference/configuration"],
  }),
  tool({
    id: "copilot-cli",
    displayName: "GitHub Copilot CLI",
    configPresence: "notRegistered",
    configDisplayPath: null,
    references: ["https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference"],
  }),
];

const READY: AiConfigState = { status: "ready", report: { tools: TOOLS } };

function renderView(): string {
  return renderToStaticMarkup(
    <AiConfigView
      state={READY}
      selectedToolId="claude-code"
      onSelectTool={noop}
      onRefresh={noop}
      claudePanel={<p>设置占位</p>}
    />,
  );
}

describe("AI 工具页布局（UIB-4d）", () => {
  it("uses the master-detail layout in the compact view", () => {
    const markup = renderView();
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("AI 工具列表");
    expect(markup).toContain('aria-label="所选工具"');
    expect(markup).toContain("设置占位");
  });

  it("leaves the page heading to the app shell", () => {
    expect(renderView()).not.toContain("<h1");
  });

  it("marks only the default Claude Code row as the current selection with the slide selection language", () => {
    const markup = renderView();
    const toolList = markup.match(/<ul aria-label="AI 工具列表"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(toolList.match(/class="[^"]*\bslide-item\b[^"]*"/g)).toHaveLength(4);
    expect(toolList.match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="true"[^>]*>(?:(?!<\/button>).)*Claude Code/);
  });

  it("shows the Claude Code panels only for the Claude tool or without a report", () => {
    expect(showsClaudePanel(selectedToolOf(TOOLS, "claude-code"))).toBe(true);
    expect(showsClaudePanel(selectedToolOf(TOOLS, "codex-cli"))).toBe(false);
    expect(showsClaudePanel(selectedToolOf([], "claude-code"))).toBe(true);
  });

  it("falls back to the first tool when the selected id is no longer reported", () => {
    expect(selectedToolOf(TOOLS, "missing-tool")?.id).toBe("claude-code");
  });
});

describe("AI 工具页没有顶部分区 tabs（r5-ai）", () => {
  it("renders no section tabs, so the tool list is the only way to switch tools", () => {
    const markup = renderView();
    expect(markup).not.toContain("data-section-id");
    expect(markup).not.toContain("AI 工具分区");
  });
});
