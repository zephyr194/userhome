import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type {
  ClaudeEditCatalog,
  ClaudeEditItem,
  ClaudeEditPreview,
  ClaudeEditResult,
} from "../../ipc/aiConfig";
import { EditPanel, PhaseView, SettingEditor } from "./SettingEditor";
import type { EditPhase } from "./claudeEditModel";

const noop = () => undefined;
const GRANT = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<ClaudeEditItem> = {}): ClaudeEditItem {
  return {
    keyPath: "effortLevel",
    valueType: "enum",
    allowedValues: ["low", "medium", "high", "xhigh"],
    editable: true,
    reason: null,
    ...overrides,
  };
}

const PREVIEW: ClaudeEditPreview = {
  operationId: "op-1",
  summary: "Replace ~/.claude/settings.json.",
  effects: ["Target: ~/.claude/settings.json"],
  expiresAt: "2026-10-21T10:00:00Z",
  keyPath: "effortLevel",
  action: "set",
  kind: "REPLACE",
  recoveryPoint: "BACKUP",
  diff: {
    lines: [
      { kind: "REMOVED", text: '"effortLevel": "low"' },
      { kind: "ADDED", text: '"effortLevel": "high"' },
    ],
    redacted: false,
    truncated: false,
  },
  reloadNote: "已写入设置文件。多数设置需新会话或重载后才生效。",
};

function render(element: ReactElement) {
  return renderToStaticMarkup(element);
}

describe("SettingEditor controls", () => {
  it("shows the reason and no controls for a display-only key", () => {
    const markup = render(
      <SettingEditor
        item={item({
          editable: false,
          reason: "版本未确认，写入已禁用：尚无已验证的版本区间",
          allowedValues: [],
        })}
        settingsGrantId={GRANT}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("版本未确认，写入已禁用：尚无已验证的版本区间");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain('role="checkbox"');
    expect(markup).toContain('disabled=""');
  });

  it("asks for a settings file before an editable key can be changed", () => {
    const markup = render(
      <SettingEditor item={item()} settingsGrantId={null} onSaved={noop} />,
    );

    expect(markup).toContain("请先选择要修改的用户设置文件。");
    expect(markup).toContain('disabled=""');
  });

  it("offers a select for an enum, a checkbox for a boolean and a text field for a string", () => {
    const enumMarkup = render(
      <SettingEditor item={item()} settingsGrantId={GRANT} onSaved={noop} />,
    );
    const boolMarkup = render(
      <SettingEditor
        item={item({
          keyPath: "alwaysThinkingEnabled",
          valueType: "boolean",
          allowedValues: [],
        })}
        settingsGrantId={GRANT}
        onSaved={noop}
      />,
    );
    const stringMarkup = render(
      <SettingEditor
        item={item({
          keyPath: "language",
          valueType: "string",
          allowedValues: [],
        })}
        settingsGrantId={GRANT}
        onSaved={noop}
      />,
    );

    expect(enumMarkup).toContain("<select");
    expect(enumMarkup).toContain("xhigh");
    expect(boolMarkup).toContain('role="checkbox"');
    expect(stringMarkup).toContain("<input");
  });

  it("names the three edit actions separately, restore-default and set-null included", () => {
    const markup = render(
      <SettingEditor item={item()} settingsGrantId={GRANT} onSaved={noop} />,
    );

    expect(markup).toContain("预览修改");
    expect(markup).toContain("恢复默认（移除该键）");
    expect(markup).toContain("设为 null");
  });
});

describe("PhaseView", () => {
  it("renders the preview diff with its summary, recovery note and both confirmation buttons", () => {
    const phase: EditPhase = { status: "previewed", preview: PREVIEW };
    const markup = render(
      <PhaseView phase={phase} onConfirm={noop} onCancel={noop} />,
    );

    expect(markup).toContain('aria-label="修改预览"');
    expect(markup).toContain("Replace ~/.claude/settings.json.");
    expect(markup).toContain("写入前会先备份当前文件");
    expect(markup).toContain("&quot;effortLevel&quot;: &quot;high&quot;");
    expect(markup).toContain("确认写入");
    expect(markup).toContain("取消");
  });

  it("says when the diff is hidden because the content is redacted", () => {
    const phase: EditPhase = {
      status: "previewed",
      preview: {
        ...PREVIEW,
        diff: { lines: [], redacted: true, truncated: false },
      },
    };

    expect(
      render(<PhaseView phase={phase} onConfirm={noop} onCancel={noop} />),
    ).toContain("内容已遮盖，不显示差异。");
  });

  it("reports an expired or rejected confirmation as an alert with its message", () => {
    const phase: EditPhase = {
      status: "failed",
      error: {
        code: "CONFLICT",
        message: "预览已过期，请重新预览。",
        retryable: false,
      },
    };
    const markup = render(
      <PhaseView phase={phase} onConfirm={noop} onCancel={noop} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("预览已过期，请重新预览。");
  });

  it("reports a successful save as a status with the reload note", () => {
    const result: ClaudeEditResult = {
      operationId: "op-1",
      reloadNote: PREVIEW.reloadNote,
      outcome: {
        kind: "REPLACE",
        status: "SUCCEEDED",
        fileState: "WRITTEN",
        recoveryPoint: "BACKUP",
        backupId: null,
        summary: "Replace.",
        error: null,
      },
    };
    const markup = render(
      <PhaseView
        phase={{ status: "saved", result }}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("已保存。已写入设置文件。多数设置需新会话或重载后才生效");
  });

  it("reports a write that was restored as an alert, not a save", () => {
    const result: ClaudeEditResult = {
      operationId: "op-1",
      reloadNote: PREVIEW.reloadNote,
      outcome: {
        kind: "REPLACE",
        status: "FAILED",
        fileState: "RESTORED",
        recoveryPoint: "BACKUP",
        backupId: null,
        summary: "Replace.",
        error: {
          code: "PARTIAL_FAILURE",
          message: "校验失败，已恢复原内容。",
          retryable: false,
        },
      },
    };
    const markup = render(
      <PhaseView
        phase={{ status: "writeFailed", result }}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("校验失败，已恢复原内容。");
    expect(markup).not.toContain("已保存。");
  });
});

describe("EditPanel", () => {
  const catalog: ClaudeEditCatalog = {
    detectedVersion: "2.1.287",
    items: [
      item({
        editable: false,
        reason: "仅展示，版本未核实",
        keyPath: "promptCacheTtl",
      }),
      item(),
    ],
  };

  it("names the detected version and lists every key, marking display-only ones", () => {
    const markup = render(
      <EditPanel
        catalog={catalog}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("本机版本：2.1.287。");
    expect(markup).toContain("promptCacheTtl（仅展示）");
    expect(markup).toContain("选择设置文件");
    expect(markup).toContain("未选择");
  });

  it("says the definitions are unavailable when the catalog did not load", () => {
    const markup = render(
      <EditPanel
        catalog={null}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("编辑定义不可用。");
  });

  it("shows a chosen settings file and offers to replace it", () => {
    const markup = render(
      <EditPanel
        catalog={catalog}
        settingsFile={{ id: GRANT, displayPath: "~/.claude/settings.json" }}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("~/.claude/settings.json");
    expect(markup).toContain("更换文件");
  });
});
