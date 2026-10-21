import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClaudeBuiltCommand, ClaudeOptionItem, ClaudeOptionSummary } from "../../ipc/aiConfig";
import { CommandBuilderView, type CommandOptionsState, type CommandPreview } from "./CommandBuilder";
import { RISK_CONFIRM_LABEL, SECRET_NOTE, type Selection } from "./commandBuilderModel";

const SECRET_SAMPLE = "sk-ant-test-0123456789";

function item(overrides: Partial<ClaudeOptionItem> = {}): ClaudeOptionItem {
  return {
    id: "--model",
    kind: "flag",
    valueType: "string",
    allowedValues: [],
    description: "Set the model for the session.",
    generatable: true,
    secret: false,
    singleInvocation: true,
    excludes: [],
    requires: [],
    risks: [],
    versions: null,
    configAlternative: null,
    ...overrides,
  };
}

const SUMMARY: ClaudeOptionSummary = {
  coverageNote: "收录范围：已核实的子集。",
  flagsCoverage: null,
  envCoverage: null,
  items: [
    item({
      id: "--restricted",
      valueType: "boolean",
      excludes: ["--dangerously-skip-permissions"],
      versions: { min: "2.1.248", max: "unknown" },
    }),
    item({
      id: "--dangerously-skip-permissions",
      valueType: "boolean",
      risks: ["relaxesPermissions"],
    }),
    item({
      id: "ANTHROPIC_API_KEY",
      kind: "env",
      secret: true,
      singleInvocation: null,
      description: "API key.",
    }),
    item({
      id: "CLAUDE_CODE_CLIENT_KEY",
      kind: "env",
      valueType: "unknown",
      generatable: false,
      singleInvocation: null,
    }),
  ],
};

const BUILT: ClaudeBuiltCommand = {
  text: "ANTHROPIC_API_KEY='<在此填入，勿提交>' claude --restricted",
  notices: [
    { id: "--restricted", status: "incompatible", message: "本机版本 2.1.100 不满足该项要求。" },
  ],
  placeholders: ["ANTHROPIC_API_KEY"],
};

function render(
  overrides: Partial<{
    options: CommandOptionsState;
    selection: Selection;
    detectedVersion: string;
    preview: CommandPreview;
    copyMessage: string | null;
  }> = {},
) {
  return renderToStaticMarkup(
    <CommandBuilderView
      options={overrides.options ?? { status: "ready", summary: SUMMARY }}
      selection={overrides.selection ?? {}}
      detectedVersion={overrides.detectedVersion ?? ""}
      preview={overrides.preview ?? { status: "idle", message: "勾选后生成命令。" }}
      copyMessage={overrides.copyMessage ?? null}
      onToggle={() => undefined}
      onValueChange={() => undefined}
      onAcknowledge={() => undefined}
      onVersionChange={() => undefined}
      onCopy={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

describe("CommandBuilderView", () => {
  it("shows loading and failure states with a retry", () => {
    expect(render({ options: { status: "loading" } })).toContain("正在读取 flags 与环境变量");
    const failed = render({
      options: {
        status: "failed",
        error: { code: "INTERNAL", message: "无法读取命令参数。", retryable: true },
      },
    });
    expect(failed).toContain("无法读取命令参数。");
    expect(failed).toContain("重试");
  });

  it("shows the coverage note, versions, exclusions and risk and secret markers in text", () => {
    const markup = render();
    expect(markup).toContain("收录范围：已核实的子集。");
    expect(markup).toContain("需要 Claude Code 2.1.248 或更高版本");
    expect(markup).toContain("与 --dangerously-skip-permissions 互斥");
    expect(markup).toContain("[风险] 放宽权限");
    expect(markup).toContain("敏感（仅占位符）");
    expect(markup).toContain("--dangerously-skip-permissions");
    expect(markup).toContain("CLAUDE_CODE_CLIENT_KEY（仅展示，不生成）");
  });

  it("explains secrets as placeholders and never renders a secret value", () => {
    const markup = render({
      preview: { status: "ready", built: BUILT },
    });
    expect(markup).toContain(SECRET_NOTE);
    expect(markup).toContain("在此填入，勿提交");
    expect(markup).not.toContain(SECRET_SAMPLE);
  });

  it("renders the generated text in a copyable block with its version notice", () => {
    const markup = render({
      preview: { status: "ready", built: BUILT },
      copyMessage: "命令已复制到剪贴板。",
    });
    expect(markup).toContain("复制命令");
    expect(markup).toContain("命令已复制到剪贴板。");
    expect(markup).toContain("--restricted：版本不兼容。本机版本 2.1.100 不满足该项要求。");
    expect(markup).toContain("claude --restricted");
  });

  it("asks for explicit risk confirmation once a risky flag is chosen", () => {
    const markup = render({
      selection: {
        "--dangerously-skip-permissions": { checked: true, value: "", acknowledged: false },
      },
    });
    expect(markup).toContain(RISK_CONFIRM_LABEL);
  });

  it("shows the idle hint when nothing is chosen", () => {
    expect(render()).toContain("勾选后生成命令。");
  });

  it("shows a failure from the backend in place of the command", () => {
    const markup = render({
      preview: {
        status: "failed",
        error: { code: "INVALID_INPUT", message: "--effort 的取值不在官方允许范围内。", retryable: false },
      },
    });
    expect(markup).toContain("--effort 的取值不在官方允许范围内。");
    expect(markup).not.toContain("复制命令");
  });
});
