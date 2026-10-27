// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolReport } from "../../ipc/aiConfig";
import type { ReferenceSetting, ToolReference } from "../../ipc/aiConfigReference";
import { AiConfigView } from "./AiConfigView";
import { configSearchItem } from "./configSearch";
import { publishToolSearchItems, useToolSearchIndex } from "./configSearchStore";
import type { AiConfigState } from "./aiConfigModel";

vi.mock("../../ipc/aiConfigReference", () => ({
  getToolReference: (toolId: string) => Promise.resolve(referenceFor(toolId)),
}));

const TOOLS: [string, string][] = [
  ["claude-code", "Claude Code"],
  ["codex-cli", "Codex CLI"],
  ["gemini-cli", "Gemini CLI"],
  ["copilot-cli", "GitHub Copilot CLI"],
];

function reportTool(id: string, displayName: string): AiToolReport {
  return {
    id: id as AiToolReport["id"],
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
  };
}

const READY: AiConfigState = {
  status: "ready",
  report: { tools: TOOLS.map(([id, name]) => reportTool(id, name)) },
};

function setting(keyPath: string, description: string, allowedValues: string[] = []): ReferenceSetting {
  return {
    id: keyPath,
    keyPath,
    valueType: allowedValues.length > 0 ? "enum" : "string",
    allowedValues,
    description,
    descriptionTruncated: false,
    defaultNote: "默认值未说明",
    defaultNoteTruncated: false,
    coverage: "displayOnly",
    risks: [],
    secret: false,
    sourceUrl: "https://example.com/config",
  };
}

const CODEX_SETTINGS = [
  setting("mcp_servers", "Configure MCP servers for the session."),
  setting("model", "Default model name.", ["gpt-5", "o4"]),
];

function referenceFor(toolId: string): ToolReference {
  return {
    toolId: toolId as ToolReference["toolId"],
    displayName: TOOLS.find(([id]) => id === toolId)?.[1] ?? toolId,
    source: { url: "https://example.com/config", retrievedOn: "2026-10-22", documentedVersion: "unknown" },
    notices: [],
    resources: [],
    settings: toolId === "codex-cli" ? CODEX_SETTINGS : [],
    flagsCoverage: { snapshotComplete: false, coverageNote: null, coverageNoteTruncated: false, sourceUrl: "https://example.com/config" },
    envCoverage: { snapshotComplete: false, coverageNote: null, coverageNoteTruncated: false, sourceUrl: "https://example.com/config" },
  } as ToolReference;
}

/** Holds query and tool state the way the page does, reading the same store the page reads. */
function Harness({ initialTool = "codex-cli" }: { initialTool?: string }) {
  const [query, setQuery] = useState("");
  const [toolId, setToolId] = useState(initialTool);
  const searchIndex = useToolSearchIndex();
  return (
    <AiConfigView
      state={READY}
      selectedToolId={toolId}
      onSelectTool={setToolId}
      onRefresh={() => undefined}
      query={query}
      onQueryChange={setQuery}
      searchIndex={searchIndex}
      claudePanel={<p>Claude 设置面板</p>}
    />
  );
}

function searchInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "搜索配置项" }) as HTMLInputElement;
}

function typeQuery(value: string): void {
  fireEvent.change(searchInput(), { target: { value } });
}

beforeEach(() => {
  publishToolSearchItems("claude-code", [
    configSearchItem({ keyPath: "claude-only.key", description: "只在 Claude 中出现", allowedValues: [] }),
  ]);
});

afterEach(() => {
  cleanup();
  publishToolSearchItems("claude-code", []);
});

describe("AI 工具配置项搜索", () => {
  it("names the search field and announces the match count politely", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    expect(searchInput().placeholder).toBe("例如 model，或说明中的关键词");
    typeQuery("mcp");
    const count = await screen.findByText("匹配 1 项");
    expect(count.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps only matching settings and marks the matched text", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("MCP");
    const list = await screen.findByRole("list", { name: "官方设置键" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("mcp_servers");
    expect(items[0]?.textContent).not.toContain("Default model name.");
    const marks = Array.from(list.querySelectorAll("mark")).map((mark) => mark.textContent);
    expect(marks).toContain("mcp");
  });

  it("matches enum values and combines terms with AND", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("gpt-5");
    expect(await screen.findByText("匹配 1 项")).toBeTruthy();
    typeQuery("model gpt-5");
    expect(await screen.findByText("匹配 1 项")).toBeTruthy();
    typeQuery("model mcp");
    expect(await screen.findByText("没有匹配的配置项。")).toBeTruthy();
  });

  it("shows the empty state and points to the other tool that has matches", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("claude-only");
    expect(await screen.findByText("没有匹配的配置项。")).toBeTruthy();
    expect(screen.queryByText("其他工具里有 1 个匹配。")).toBeNull();
    expect(screen.getByRole("button", { name: "查看 Claude Code（1 项）" })).toBeTruthy();
    expect(screen.getByText("还有 2 个工具尚未打开过，其配置项未计入。")).toBeTruthy();
  });

  it("switches to the other tool and keeps the search term", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("claude-only");
    fireEvent.click(await screen.findByRole("button", { name: "查看 Claude Code（1 项）" }));
    await waitFor(() => expect(searchInput().value).toBe("claude-only"));
    expect(screen.getByText("匹配 1 项")).toBeTruthy();
    expect(screen.queryByText("没有匹配的配置项。")).toBeNull();
  });

  it("clears the query with Escape and keeps focus in the field", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("mcp");
    searchInput().focus();
    fireEvent.keyDown(searchInput(), { key: "Escape" });
    expect(searchInput().value).toBe("");
    expect(document.activeElement).toBe(searchInput());
    expect(screen.queryByText(/匹配 \d+ 项/)).toBeNull();
  });

  it("clears the query from the keyboard-operable clear button", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    typeQuery("mcp");
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(searchInput().value).toBe("");
    expect(screen.getAllByRole("listitem")).not.toHaveLength(0);
  });

  it("does not offer a clear button while the field is empty", async () => {
    render(<Harness />);
    await screen.findByRole("list", { name: "官方设置键" });
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
  });
});
