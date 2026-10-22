import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionContext } from "../../app/SectionContext";
import type { AiToolReport } from "../../ipc/aiConfig";
import { isTextVisible } from "../../test/markupVisibility";
import { AiConfigView } from "./AiConfigView";
import { sectionForTool, toolIdForSection, type AiConfigState } from "./aiConfigModel";

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

function render(section?: string): string {
  return renderToStaticMarkup(
    <SectionContext.Provider value={section === undefined ? undefined : { section, select: noop }}>
      <AiConfigView state={READY} onRetry={noop} claudePanel={<p>设置占位</p>} />
    </SectionContext.Provider>,
  );
}

describe("AI config sections", () => {
  it("renders the four tool sections as tabs with the selected one current", () => {
    const markup = render("codex");
    expect(markup.match(/data-section-id="/g)).toHaveLength(4);
    const current = markup.match(/<[a-z]+[^>]*data-section-id="codex"[^>]*>/)?.[0] ?? "";
    expect(current).toContain('aria-current="true"');
  });

  it("selects the Claude Code panels for the claude section", () => {
    const markup = render("claude");
    expect(isTextVisible(markup, "设置占位")).toBe(true);
    expect(markup).toMatch(/aria-current="true"[^>]*>(?:(?!<\/button>).)*Claude Code/);
  });

  it("selects the tool named by the section and hides the Claude Code panels", () => {
    const markup = render("codex");
    expect(isTextVisible(markup, "设置占位")).toBe(false);
    expect(markup).toMatch(/aria-current="true"[^>]*>(?:(?!<\/button>).)*Codex CLI/);
  });

  it("falls back to Claude Code without a shell section or for an unknown section", () => {
    expect(isTextVisible(render(), "设置占位")).toBe(true);
    expect(isTextVisible(render("retired"), "设置占位")).toBe(true);
  });

  it("maps each section to its tool and back", () => {
    expect(toolIdForSection("copilot")).toBe("copilot-cli");
    expect(sectionForTool("gemini-cli")).toBe("gemini");
    expect(sectionForTool("unknown-tool")).toBe("claude");
  });
});
