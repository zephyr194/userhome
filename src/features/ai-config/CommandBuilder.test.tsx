import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ClaudeBuiltCommand,
  ClaudeListingCoverage,
  ClaudeOptionItem,
  ClaudeOptionSummary,
} from "../../ipc/aiConfig";
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

const FLAGS_LISTING: ClaudeListingCoverage = {
  listedCount: 2,
  snapshotComplete: false,
  coverageNote: "官方 CLI 参考页的 flags 更多（未统计总数）；仅收录 2 项。",
  sourceUrl: "https://code.claude.com/docs/en/cli-reference",
  retrievedOn: "2026-10-21",
};

const ENV_LISTING: ClaudeListingCoverage = {
  listedCount: 2,
  snapshotComplete: false,
  coverageNote: "官方环境变量页面共 230 项以上；仅收录 2 项。",
  sourceUrl: "https://code.claude.com/docs/en/env-vars",
  retrievedOn: "2026-10-21",
};

function withCoverage(
  flagsCoverage: ClaudeListingCoverage | null,
  envCoverage: ClaudeListingCoverage | null,
): CommandOptionsState {
  return { status: "ready", summary: { ...SUMMARY, flagsCoverage, envCoverage } };
}

function noticeOf(markup: string): string {
  const match = /<div role="note"[\s\S]*?<\/div>/.exec(markup);
  return match === null ? "" : match[0];
}

describe("CommandBuilderView listing coverage notice", () => {
  it("states partial listing with counts, the unlisted caveat and plain source URLs", () => {
    const markup = render({ options: withCoverage(FLAGS_LISTING, ENV_LISTING) });
    const notice = noticeOf(markup);

    expect(notice).toContain("⚠ 部分收录：已收录 2 项 flags / 2 项环境变量；官方页面更多，未收录项不可选。");
    expect(notice).toContain("官方 CLI 参考页的 flags 更多");
    expect(notice).toContain("官方环境变量页面共 230 项以上");
    expect(notice).toContain("https://code.claude.com/docs/en/cli-reference");
    expect(notice).toContain("https://code.claude.com/docs/en/env-vars");
    expect(notice).toContain("2026-10-21");
    expect(notice).not.toContain("<a ");
  });

  it("treats absent listing coverage as unknown and therefore partial", () => {
    const markup = render({ options: withCoverage(null, null) });
    const notice = noticeOf(markup);

    expect(notice).toContain("⚠ 收录范围未知，按部分收录处理：官方页面更多，未收录项不可选。");
    expect(notice).not.toContain("已完整收录");
  });

  it("treats a single unknown listing as unknown rather than complete", () => {
    const notice = noticeOf(render({ options: withCoverage(FLAGS_LISTING, null) }));

    expect(notice).toContain("收录范围未知，按部分收录处理");
    expect(notice).not.toContain("已完整收录");
  });

  it("says complete only when both listings are complete", () => {
    const notice = noticeOf(
      render({
        options: withCoverage(
          { ...FLAGS_LISTING, snapshotComplete: true, coverageNote: null },
          { ...ENV_LISTING, snapshotComplete: true, coverageNote: null },
        ),
      }),
    );

    expect(notice).toContain("✔ 已完整收录：已收录 2 项 flags / 2 项环境变量。");
    expect(notice).not.toContain("部分收录");
  });

  it("keeps the coverage note line that was already shown", () => {
    expect(render({ options: withCoverage(FLAGS_LISTING, ENV_LISTING) })).toContain(
      "收录范围：已核实的子集。",
    );
  });
});
