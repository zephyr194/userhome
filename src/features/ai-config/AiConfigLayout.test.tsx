import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BoardViewContext,
  type BoardViewContextValue,
} from "../../app/BoardViewContext";
import type { AiToolReport } from "../../ipc/aiConfig";
import { AiConfigView } from "./AiConfigView";
import { selectedToolOf, showsClaudePanel, type AiConfigState } from "./aiConfigModel";

const noop = () => undefined;

const COMPACT: BoardViewContextValue = {
  available: true,
  view: "compact",
  isBoard: false,
  enter: noop,
  exit: noop,
  toggle: noop,
};
const BOARD: BoardViewContextValue = {
  ...COMPACT,
  view: "board",
  isBoard: true,
};

function tool(overrides: Partial<AiToolReport>): AiToolReport {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    installStatus: "missing",
    displayPath: null,
    invalidReason: null,
    version: null,
    configPresence: "found",
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
    references: ["https://developers.openai.com/codex/config-basic"],
  }),
  tool({
    id: "gemini-cli",
    displayName: "Gemini CLI",
    configPresence: "notRegistered",
    references: ["https://geminicli.com/docs/reference/configuration"],
  }),
  tool({
    id: "copilot-cli",
    displayName: "GitHub Copilot CLI",
    configPresence: "notRegistered",
    references: ["https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference"],
  }),
];

const READY: AiConfigState = { status: "ready", report: { tools: TOOLS } };

function renderView(context: BoardViewContextValue): string {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={context}>
      <AiConfigView
        state={READY}
        onRetry={noop}
        claudePanel={<p>设置占位</p>}
      />
    </BoardViewContext.Provider>,
  );
}

function withoutClasses(markup: string): string {
  return markup.replace(/ class="[^"]*"/g, "");
}

describe("AI 配置页布局（UIB-4d）", () => {
  it("uses the master-detail layout in the compact view", () => {
    const markup = renderView(COMPACT);
    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__cell--span-");
    expect(markup).toContain("AI 工具列表");
    expect(markup).toContain('aria-label="所选工具"');
    expect(markup).toContain("设置占位");
  });

  it("uses the board layout with a 4 tool list and an 8 detail column, keeping every block visible", () => {
    const markup = renderView(BOARD);
    expect(markup).toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__layout--master-detail");
    expect(markup).toContain("page-shell__cell--span-4");
    expect(markup).toContain("page-shell__cell--span-8");
    expect(markup).toContain("AI 工具列表");
    expect(markup).toContain('aria-label="所选工具"');
    expect(markup).toContain("设置占位");
  });

  it("renders the same element tree in both views so switching never remounts", () => {
    expect(withoutClasses(renderView(BOARD))).toBe(withoutClasses(renderView(COMPACT)));
  });

  it("leaves the page heading to the app shell", () => {
    for (const markup of [renderView(COMPACT), renderView(BOARD)]) {
      expect(markup).not.toContain("<h1");
    }
  });

  it("marks only the default Claude Code row as the current selection with the bracket language", () => {
    const markup = renderView(COMPACT);
    expect(markup.match(/class="[^"]*\bbracket\b[^"]*"/g)).toHaveLength(4);
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
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
