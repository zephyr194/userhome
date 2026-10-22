import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiConfigReport, AiToolReport } from "../../ipc/aiConfig";
import { AiConfigView } from "./AiConfigView";
import {
  INSTALL_LABELS,
  countInconclusive,
  isInconclusive,
  summarizeState,
  type AiConfigState,
} from "./aiConfigModel";

const noop = () => undefined;

function tool(overrides: Partial<AiToolReport> = {}): AiToolReport {
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

const FOUR_TOOLS: AiToolReport[] = [
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
    references: [
      "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
    ],
  }),
];

function ready(tools: AiToolReport[] = FOUR_TOOLS): AiConfigState {
  return { status: "ready", report: { tools } };
}

function render(state: AiConfigState, extra: Partial<ComponentProps<typeof AiConfigView>> = {}): string {
  return renderToStaticMarkup(
    <AiConfigView
      state={state}
      selectedToolId="claude-code"
      onSelectTool={noop}
      onRefresh={noop}
      {...extra}
    />,
  );
}

describe("AiConfigView states", () => {
  it("shows a loading notice and no tool cards while detection runs", () => {
    const html = render({ status: "loading" });

    expect(html).toContain("正在检测 AI 工具");
    expect(html).not.toContain("官方参考");
  });

  it("shows an alert with a retry action when detection fails", () => {
    const html = render({
      status: "failed",
      error: { code: "INTERNAL", message: "内部错误", retryable: false },
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("无法检测 AI 工具");
    expect(html).toContain("内部错误");
    expect(html).toContain("重试");
  });

  it("shows the empty notice for a report without tools", () => {
    const html = render({ status: "ready", report: { tools: [] } });

    expect(html).toContain("没有可检测的 AI 工具");
  });

  it("names how many tools were inconclusive when some probes failed", () => {
    const html = render(
      ready([
        FOUR_TOOLS[0],
        tool({
          id: "codex-cli",
          displayName: "Codex CLI",
          installStatus: "invalid",
          displayPath: "~/.local/bin/codex",
          invalidReason: "notExecutable",
        }),
        FOUR_TOOLS[2],
        FOUR_TOOLS[3],
      ]),
    );

    expect(html).toContain("有 1 个工具无法完整检测");
    expect(html).toContain("没有可执行权限");
  });

  it("shows all four tools with the disclaimer about the fixed version probe", () => {
    const html = render(ready());

    for (const name of ["Claude Code", "Codex CLI", "Gemini CLI", "GitHub Copilot CLI"]) {
      expect(html).toContain(name);
    }
    expect(html).toContain("版本检测只运行固定的 --version，不读取凭据、不发起模型请求");
  });
});

describe("AiConfigView list and loading (r4-fe4)", () => {
  it("reserves four fixed-height skeleton rows while detection runs", () => {
    const html = render({ status: "loading" });

    expect(html.match(/ai-tool-skeleton"/g)).toHaveLength(4);
    expect(html).toContain('aria-hidden="true" class="m-0 grid list-none');
  });

  it("keeps paths and versions out of the list rows, leaving them to the selected detail", () => {
    const html = render(ready());

    expect(html).not.toContain("未找到可执行文件");
    expect(html).not.toContain("版本未确认");
    expect(html).toContain("2.1.0 (Claude Code)");
  });
});

describe("AiConfigView facts", () => {
  it("keeps the installed status and the config-file presence as separate facts", () => {
    const html = render(
      ready([
        tool({ installStatus: "missing", configPresence: "found" }),
        ...FOUR_TOOLS.slice(1),
      ]),
    );

    expect(html).toContain("未找到");
    expect(html).toContain("已发现配置文件（不代表已安装）");
    expect(html).not.toContain("已找到");
  });

  it("shows official references and an unconfirmed version for a missing tool", () => {
    const html = render(ready([tool(), ...FOUR_TOOLS.slice(1)]));

    expect(html).toContain("https://code.claude.com/docs/en/settings");
    expect(html).toContain("未找到可执行文件");
    expect(html).toContain("版本未确认");
  });

  it("pairs each status with a symbol so state is not conveyed by colour alone", () => {
    const html = render(ready());

    expect(html).toContain("✓ ");
    expect(html).toContain("○ ");
  });

  it("states that a config location not yet registered is unknown rather than missing", () => {
    const html = render(ready([tool({ configPresence: "notRegistered" }), ...FOUR_TOOLS.slice(1)]));

    expect(html).toContain("暂未提供配置位置");
    expect(html).not.toContain("待各工具的快照任务");
  });

  it("shows the found version as text when detection confirmed it", () => {
    const html = render(ready());

    expect(html).toContain("2.1.0 (Claude Code)");
    expect(html).toContain("/opt/homebrew/bin/claude");
  });
});

describe("aiConfigModel", () => {
  it("summarizes loading, failure, empty, partial and ready states", () => {
    expect(summarizeState({ status: "loading" })).toBe("loading");
    expect(
      summarizeState({
        status: "failed",
        error: { code: "INTERNAL", message: "内部错误", retryable: false },
      }),
    ).toBe("error");
    expect(summarizeState(ready([]))).toBe("empty");
    expect(summarizeState(ready(FOUR_TOOLS))).toBe("ready");
    expect(
      summarizeState(ready([...FOUR_TOOLS.slice(0, 3), tool({ id: "copilot-cli", installStatus: "invalid", displayPath: "/x", invalidReason: "outsideRoot" })])),
    ).toBe("partial");
  });

  it("treats an invalid install or an unavailable config check as inconclusive", () => {
    expect(isInconclusive(tool({ installStatus: "invalid", displayPath: "/x", invalidReason: "unreadable" }))).toBe(true);
    expect(isInconclusive(tool({ configPresence: "unavailable" }))).toBe(true);
    expect(isInconclusive(tool({ installStatus: "missing", configPresence: "notRegistered" }))).toBe(false);
  });

  it("counts inconclusive tools in a report", () => {
    const report: AiConfigReport = {
      tools: [tool({ configPresence: "unavailable" }), ...FOUR_TOOLS.slice(1)],
    };

    expect(countInconclusive(report)).toBe(1);
  });

  it("gives every install status a distinct symbol and label", () => {
    const labels = Object.values(INSTALL_LABELS);

    expect(new Set(labels.map((entry) => entry.label)).size).toBe(3);
    expect(new Set(labels.map((entry) => entry.symbol)).size).toBe(3);
  });
});

describe("AiConfigView refresh (r5-ai)", () => {
  it("keeps the shown tools and says a refresh is running", () => {
    const html = render(ready(), { refreshing: true });

    expect(html).toContain("正在刷新…");
    expect(html).toContain("Codex CLI");
    expect(html).not.toContain("正在检测 AI 工具");
  });

  it("disables the refresh action while a refresh runs", () => {
    const html = render(ready(), { refreshing: true });

    expect(html).toMatch(/<button[^>]*disabled[^>]*>刷新<\/button>/);
  });

  it("keeps the last report and explains a failed refresh with a retry", () => {
    const html = render(ready(), {
      refreshError: { code: "INTERNAL", message: "检测命令没有返回结果。", retryable: true },
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("刷新失败，仍显示上次读取的结果");
    expect(html).toContain("检测命令没有返回结果。");
    expect(html).toContain("Claude Code");
    expect(html).not.toContain("无法检测 AI 工具");
  });

  it("names the refresh action 刷新 in the header", () => {
    const html = render(ready());

    expect(html).toMatch(/<button[^>]*>刷新<\/button>/);
    expect(html).not.toContain("重新检测");
  });
});
