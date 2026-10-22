import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReferenceSetting, ToolReference as ToolReferenceData } from "../../ipc/aiConfigReference";
import { createInternalError } from "../../ipc/core";
import { ToolReferenceView, type ToolReferenceState } from "./ToolReference";

const GEMINI_URL = "https://geminicli.com/docs/reference/configuration/";
const NOTICE = `官方配置页与 GitHub README 均写明：未付费用户与 Google One 用户的 Gemini CLI 已于 2026-06-18 被 Antigravity CLI 替代（来源：${GEMINI_URL}，抓取日期 2026-10-22）。本机是否受影响无法从官方文档判断。`;

function setting(index: number, overrides: Partial<ReferenceSetting> = {}): ReferenceSetting {
  return {
    id: `setting-${index}`,
    keyPath: `group.key${index}`,
    valueType: "string",
    allowedValues: [],
    description: `Description ${index}.`,
    descriptionTruncated: false,
    defaultNote: `默认 ${index}`,
    defaultNoteTruncated: false,
    coverage: "displayOnly",
    risks: [],
    secret: false,
    sourceUrl: GEMINI_URL,
    ...overrides,
  };
}

function reference(overrides: Partial<ToolReferenceData> = {}): ToolReferenceData {
  return {
    toolId: "gemini-cli",
    displayName: "Gemini CLI",
    source: { url: GEMINI_URL, retrievedOn: "2026-10-22", documentedVersion: "unknown" },
    notices: [NOTICE],
    resources: [
      {
        id: "gemini-user-settings",
        layer: "userLevel",
        format: "json",
        location: "{home}/.gemini/settings.json",
        coverage: "versionUnknown",
        description: "用户级设置文件。",
        descriptionTruncated: false,
        metadataOnly: false,
        sourceUrl: GEMINI_URL,
      },
      {
        id: "gemini-auth-credentials",
        layer: "userLevel",
        format: "json",
        location: "{home}/.gemini/oauth.json",
        coverage: "unsupported",
        description: "凭据文件，仅展示元数据。",
        descriptionTruncated: false,
        metadataOnly: true,
        sourceUrl: GEMINI_URL,
      },
    ],
    settings: [
      setting(1, {
        keyPath: "mcpServers",
        valueType: "object",
        description: "Configuration for MCP servers.",
        risks: ["externalServer"],
      }),
      setting(2, {
        keyPath: "general.preferredEditor",
        valueType: "enum",
        allowedValues: ["vim", "emacs"],
        risks: ["executesCommand"],
      }),
    ],
    flagsCoverage: {
      snapshotComplete: false,
      coverageNote: "命令行参数未逐项核实。",
      coverageNoteTruncated: false,
      sourceUrl: GEMINI_URL,
    },
    envCoverage: {
      snapshotComplete: false,
      coverageNote: null,
      coverageNoteTruncated: false,
      sourceUrl: GEMINI_URL,
    },
    ...overrides,
  };
}

function ready(value: ToolReferenceData): ToolReferenceState {
  return { status: "ready", reference: value };
}

function render(state: ToolReferenceState): string {
  return renderToStaticMarkup(<ToolReferenceView state={state} onRetry={() => undefined} />);
}

describe("ToolReferenceView", () => {
  it("shows the loading status while the reference is read", () => {
    expect(render({ status: "loading" })).toContain("正在读取官方设置参考");
  });

  it("shows the failure message and a retry control", () => {
    const markup = render({
      status: "failed",
      error: { ...createInternalError(), message: "AI 工具定义校验失败。" },
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("无法读取官方设置参考");
    expect(markup).toContain("AI 工具定义校验失败。");
    expect(markup).toContain("重试");
  });

  it("states that only the official reference is shown and nothing local is read", () => {
    const markup = render(ready(reference()));
    expect(markup).toContain("官方设置参考（只展示）：未读取本机配置文件，不可编辑。");
    expect(markup).toContain(GEMINI_URL);
    expect(markup).toContain("抓取日期 2026-10-22，适用版本未知");
  });

  it("renders the Gemini migration notice with a warning label, not only its colour", () => {
    const markup = render(ready(reference()));
    expect(markup).toContain('aria-label="官方提示"');
    expect(markup).toContain("需注意");
    expect(markup).toContain("Antigravity CLI");
    expect(markup).toContain("本机是否受影响无法从官方文档判断。");
  });

  it("omits the notice list when a tool has no notices", () => {
    const markup = render(ready(reference({ toolId: "codex-cli", displayName: "Codex CLI", notices: [] })));
    expect(markup).not.toContain('aria-label="官方提示"');
    expect(markup).not.toContain("需注意");
  });

  it("lists resources with coverage badges and marks authentication entries as metadata only", () => {
    const markup = render(ready(reference()));
    expect(markup).toContain("来源资源（2）");
    expect(markup).toContain("版本未确认，仅展示");
    expect(markup).toContain("不支持读取，仅展示元数据");
    expect(markup).toContain("仅元数据");
  });

  it("shows setting type, risk and secret badges with the official default note", () => {
    const markup = render(
      ready(
        reference({
          settings: [
            setting(3, {
              keyPath: "auth.token",
              secret: true,
              risks: ["relaxesPermissions"],
            }),
          ],
        }),
      ),
    );
    expect(markup).toContain("auth.token");
    expect(markup).toMatch(/<span[^>]*>文本<\/span>/);
    expect(markup).toContain("放宽权限");
    expect(markup).toContain(">敏感<");
    expect(markup).toContain("默认值：默认 3");
  });

  it("lists enum values and says when a description was cut at the backend limit", () => {
    const markup = render(
      ready(
        reference({
          settings: [
            setting(4, {
              keyPath: "general.preferredEditor",
              valueType: "enum",
              allowedValues: ["vim", "emacs"],
              description: "x".repeat(600),
              descriptionTruncated: true,
            }),
          ],
        }),
      ),
    );
    expect(markup).toContain("可选值：vim、emacs");
    expect(markup).toContain("说明已截断，完整内容见官方来源");
  });

  it("shows the first 50 settings and a control to show more", () => {
    const settings = Array.from({ length: 120 }, (_, index) => setting(index));
    const markup = render(ready(reference({ settings })));

    expect(markup).toContain("设置清单（120 / 120）");
    expect(markup.split("默认值：").length - 1).toBe(50);
    expect(markup).toContain("显示更多（还有 70 项）");
  });

  it("reports an empty settings list without a show-more control", () => {
    const markup = render(ready(reference({ settings: [] })));
    expect(markup).toContain("设置清单（0 / 0）");
    expect(markup).toContain("没有匹配的设置键。");
    expect(markup).not.toContain("显示更多");
  });

  it("explains the coverage of flags and environment variables", () => {
    const markup = render(ready(reference()));
    expect(markup).toContain("命令行参数：收录不完整。命令行参数未逐项核实。");
    expect(markup).toContain("环境变量：收录不完整");
  });
});
