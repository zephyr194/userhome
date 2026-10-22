// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render as renderInDom,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ClaudeEditCatalog,
  ClaudeEditItem,
  ClaudeEditPreview,
  ClaudeEditResult,
} from "../../ipc/aiConfig";
import type { ClaudeReadView } from "../../ipc/aiConfig";
import { EditPanel, PhaseView, SettingEditor } from "./SettingEditor";
import type { EditPhase } from "./claudeEditModel";

const noop = () => undefined;
const GRANT = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

function item(overrides: Partial<ClaudeEditItem> = {}): ClaudeEditItem {
  return {
    keyPath: "effortLevel",
    valueType: "enum",
    allowedValues: ["low", "medium", "high", "xhigh"],
    editable: true,
    reason: null,
    verifiedVersion: "2.1.287",
    description: "Effort level for the session.",
    descriptionTruncated: false,
    defaultNote: "未设置时由 CLI 决定",
    sourceUrl: "https://code.claude.com/docs/en/settings-reference",
    sourceRetrievedOn: "2026-10-21",
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
    expect(markup).not.toContain('aria-haspopup="listbox"');
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

    expect(enumMarkup).toContain('aria-haspopup="listbox"');
    renderInDom(<SettingEditor item={item()} settingsGrantId={GRANT} onSaved={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "取值" }));
    expect(screen.getByRole("option", { name: "xhigh" })).toBeTruthy();
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
    const panel = (
      <EditPanel
        catalog={catalog}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />
    );
    const markup = render(panel);

    expect(markup).toContain("本机版本：2.1.287。");
    renderInDom(panel);
    fireEvent.click(screen.getByRole("button", { name: "选择要编辑的键" }));
    expect(
      screen.getByRole("option", { name: "promptCacheTtl（仅展示）" }),
    ).toBeTruthy();
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

describe("EditPanel settings form", () => {
  const editableCatalog: ClaudeEditCatalog = {
    detectedVersion: "2.1.287",
    items: [item()],
  };

  it("shows each official description unchanged with its default and source", () => {
    const markup = render(
      <EditPanel
        catalog={editableCatalog}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("Effort level for the session.");
    expect(markup).toContain("默认值：未设置时由 CLI 决定");
    expect(markup).toContain("https://code.claude.com/docs/en/settings-reference");
    expect(markup).toContain("抓取日期 2026-10-21");
  });

  it("shows the user-level value a key has, and says when the view is not loaded", () => {
    const view: ClaudeReadView = {
      toolId: "claude-code",
      layers: [],
      warnings: [],
      entries: [
        {
          key: "effortLevel",
          documented: true,
          valueType: "enum",
          coverage: "editable",
          value: "high",
          masked: false,
          merged: false,
          winner: "claude-user-settings",
          definedIn: [{ layerId: "claude-user-settings", overridden: false }],
        },
      ],
    };
    const withView = render(
      <EditPanel
        catalog={editableCatalog}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        view={view}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );
    const withoutView = render(
      <EditPanel
        catalog={editableCatalog}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(withView).toContain("当前用户值：&quot;high&quot;");
    expect(withoutView).toContain("当前用户值：未读取");
  });

  it("keeps display-only keys without any control, inside a collapsed group", () => {
    const markup = render(
      <EditPanel
        catalog={{
          detectedVersion: "2.1.287",
          items: [
            item({
              keyPath: "promptCacheTtl",
              valueType: "string",
              allowedValues: [],
              editable: false,
              reason: "仅展示，版本未核实",
              verifiedVersion: null,
            }),
          ],
        }}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("仅展示（1）");
    expect(markup).not.toContain('open=""');
    expect(markup).toContain("仅展示，版本未核实");
    expect(markup.split('aria-haspopup="listbox"').length - 1).toBe(1);
    expect(markup.split('role="checkbox"').length - 1).toBe(1);
  });

  it("says the local version is undetected and that no version is verified", () => {
    const markup = render(
      <EditPanel
        catalog={{
          detectedVersion: null,
          items: [
            item({
              editable: false,
              reason: "版本未确认，写入已禁用：未能检测本机版本",
              verifiedVersion: null,
            }),
          ],
        }}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("未检测到本机版本。尚无已验证版本。");
    expect(markup).toContain("版本未检测");
    expect(markup).toContain("未能检测本机版本");
  });

  it("names the version a version-gated key needs", () => {
    const markup = render(
      <EditPanel
        catalog={{
          detectedVersion: "2.2.0",
          items: [
            item({
              editable: false,
              reason: "版本未确认，写入已禁用：本机版本不在已验证区间内",
              verifiedVersion: "2.1.287",
            }),
          ],
        }}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={noop}
        onSaved={noop}
      />,
    );

    expect(markup).toContain("需要版本 2.1.287");
    expect(markup).toContain("本机版本不在已验证区间内");
  });
});
