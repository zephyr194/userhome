import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClaudeReadView } from "../../ipc/aiConfig";
import { ClaudeSettingsView } from "./ToolSettings";

const noop = () => undefined;

const readView: ClaudeReadView = {
  toolId: "claude-code",
  layers: [],
  entries: [
    {
      key: "model",
      documented: true,
      valueType: "string",
      coverage: "displayOnly",
      value: "claude-x",
      masked: false,
      merged: false,
      winner: "claude-user-settings",
      definedIn: [{ layerId: "claude-user-settings", overridden: false }],
    },
    {
      key: "env",
      documented: true,
      valueType: "unknown",
      coverage: "displayOnly",
      value: "[REDACTED]",
      masked: true,
      merged: false,
      winner: "claude-user-settings",
      definedIn: [{ layerId: "claude-user-settings", overridden: false }],
    },
  ],
  warnings: [],
};

function render(query: string): string {
  return renderToStaticMarkup(
    <ClaudeSettingsView
      state={{ status: "ready", view: readView }}
      snapshot={null}
      projectGrant={null}
      selection={{ status: "idle" }}
      onChooseProject={noop}
      onClearProject={noop}
      onRetry={noop}
      query={query}
    />,
  );
}

describe("ClaudeSettingsView configured keys with search", () => {
  it("shows every configured key when the query is empty", () => {
    const markup = render("");
    expect(markup).toContain("claude-x");
    expect(markup).not.toContain("config-search-mark");
  });

  it("keeps only matching keys and marks the matched text", () => {
    const markup = render("MODEL");
    expect(markup).toContain('<mark class="config-search-mark">model</mark>');
    expect(markup).not.toContain(">env<");
  });

  it("says so when no configured key matches", () => {
    const markup = render("不存在的键");
    expect(markup).toContain("没有匹配的设置键。");
    expect(markup).not.toContain('aria-label="设置键"');
  });
});
