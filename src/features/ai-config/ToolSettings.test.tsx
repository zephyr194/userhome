import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClaudeReadView, ClaudeSnapshotSummary } from "../../ipc/aiConfig";
import { ClaudeSettingsView, type ClaudeReadState } from "./ToolSettings";

const noop = () => undefined;

const snapshot: ClaudeSnapshotSummary = {
  toolId: "claude-code",
  displayName: "Claude Code",
  sourceUrl: "https://code.claude.com/docs/en/settings-reference",
  retrievedOn: "2026-10-21",
  documentedVersion: "unknown",
  settingCount: 245,
  resourceCount: 5,
  editable: 0,
  displayOnly: 250,
  versionUnknown: 0,
  notApplicable: 0,
  unsupported: 0,
  unknownValueType: 216,
};

const readView: ClaudeReadView = {
  toolId: "claude-code",
  layers: [
    { id: "claude-managed-settings", layer: "managed", location: "{managed}/managed-settings.json", precedence: 1, state: { kind: "missing", message: null } },
    { id: "claude-user-settings", layer: "userLevel", location: "{home}/.claude/settings.json", precedence: 4, state: { kind: "malformed", message: "重复键：model" } },
  ],
  entries: [
    {
      key: "model",
      documented: true,
      valueType: "string",
      coverage: "displayOnly",
      value: "claude-x",
      masked: false,
      merged: false,
      winner: "claude-managed-settings",
      definedIn: [
        { layerId: "claude-managed-settings", overridden: false },
        { layerId: "claude-user-settings", overridden: true },
      ],
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

function render(state: ClaudeReadState, overrides: Partial<Parameters<typeof ClaudeSettingsView>[0]> = {}) {
  return renderToStaticMarkup(
    <ClaudeSettingsView
      state={state}
      snapshot={snapshot}
      projectGrant={null}
      selection={{ status: "idle" }}
      onChooseProject={noop}
      onClearProject={noop}
      onRetry={noop}
      {...overrides}
    />,
  );
}

describe("ClaudeSettingsView", () => {
  it("states that editing is gated until versions are verified and reports the definition provenance", () => {
    const markup = render({ status: "ready", view: readView });

    expect(markup).toContain("不修改信任设置。");
    expect(markup).toContain("哪些设置可以修改由应用逐项判断");
    expect(markup).toContain("抓取日期 2026-10-21");
    expect(markup).toContain("适用版本未知");
    expect(markup).toContain("其中 0 项可以修改");
  });

  it("lists layers in precedence order with their states", () => {
    const markup = render({ status: "ready", view: readView });

    expect(markup.indexOf("托管设置（只读）")).toBeLessThan(markup.indexOf("用户设置"));
    expect(markup).toContain("解析失败：重复键：model");
    expect(markup).toContain("部分来源不可读或存在解析问题");
  });

  it("marks display-only entries, masked secrets, and the winning and overridden layers", () => {
    const markup = render({ status: "ready", view: readView });

    expect(markup).toContain("[仅展示]");
    expect(markup).toContain("[类型未核实·仅展示]");
    expect(markup).toContain("[已遮盖]");
    expect(markup).toContain("来源：托管设置（只读） · 被覆盖：用户设置");
    expect(markup).toContain("[REDACTED]");
  });

  it("offers project selection and reflects the chosen directory", () => {
    expect(render({ status: "ready", view: readView })).toContain("选择项目");
    const withProject = render(
      { status: "ready", view: readView },
      { projectGrant: { id: "11111111-1111-4111-8111-111111111111", displayPath: "~/work/a" } },
    );
    expect(withProject).toContain("更换项目");
    expect(withProject).toContain("取消项目");
    expect(withProject).toContain("~/work/a");
  });

  it("renders loading, empty, and failed states", () => {
    expect(render({ status: "loading" })).toContain("正在读取 Claude Code 设置");
    expect(
      render({ status: "ready", view: { ...readView, entries: [] } }),
    ).toContain("未发现已设置的键。");
    const failed = render({
      status: "failed",
      error: { code: "INTERNAL", message: "读取失败。", retryable: true } as never,
    });
    expect(failed).toContain("读取失败。");
    expect(failed).toContain("重新读取");
  });

  it("shows a selection failure without changing the view", () => {
    const markup = render(
      { status: "ready", view: readView },
      { selection: { status: "failed", error: { code: "INTERNAL", message: "选择失败。", retryable: false } as never } },
    );
    expect(markup).toContain("选择失败。");
    expect(markup).toContain("[仅展示]");
  });
});
