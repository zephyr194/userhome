import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClaudeBuiltCommand } from "../../ipc/aiConfig";
import type { AppError } from "../../ipc/core";
import { TerminalOpenControl, type CommandPreview } from "./CommandBuilder";
import { TERMINAL_IDLE, terminalBlockReason, type TerminalOpenState } from "./terminalOpenModel";

const BUILT: ClaudeBuiltCommand = {
  text: "claude --print",
  notices: [],
  placeholders: [],
};
const SECRET_BUILT: ClaudeBuiltCommand = {
  text: "ANTHROPIC_API_KEY='<在此填入，勿提交>' claude",
  notices: [],
  placeholders: ["ANTHROPIC_API_KEY"],
};
const READY: CommandPreview = { status: "ready", built: BUILT };
const BLOCKED: CommandPreview = { status: "idle", message: "勾选后生成命令。" };
const FAILED_ERROR = {
  code: "INVALID_INPUT",
  message: "--effort 的取值不在官方允许范围内。",
  retryable: false,
} as AppError;
const noop = () => undefined;

function control(preview: CommandPreview, terminal: TerminalOpenState = TERMINAL_IDLE) {
  return renderToStaticMarkup(
    <TerminalOpenControl
      preview={preview}
      terminal={terminal}
      onRequest={noop}
      onCancel={noop}
      onConfirm={noop}
    />,
  );
}

const OPEN_BUTTON_ENABLED = /<button(?![^>]* disabled="")[^>]*>在终端打开<\/button>/;
const OPEN_BUTTON_DISABLED = /<button[^>]* disabled=""[^>]*>在终端打开<\/button>/;
const CONFIRM_BUTTON_DISABLED = /<button[^>]* disabled=""[^>]*>在 Terminal 中打开<\/button>/;

describe("terminalBlockReason", () => {
  it("is null only when the command has been generated", () => {
    expect(terminalBlockReason(READY)).toBeNull();
  });

  it("explains each state that blocks opening", () => {
    expect(terminalBlockReason(BLOCKED)).toBe("勾选后生成命令。");
    expect(terminalBlockReason({ status: "loading" })).toBe("正在生成命令…");
    expect(terminalBlockReason({ status: "failed", error: FAILED_ERROR })).toBe(
      "--effort 的取值不在官方允许范围内。",
    );
  });
});

describe("TerminalOpenControl", () => {
  it("is disabled with the reason while the command cannot be generated", () => {
    const markup = control(BLOCKED);
    expect(markup).toMatch(OPEN_BUTTON_DISABLED);
    expect(markup).toContain("无法在终端打开：勾选后生成命令。");
    expect(markup).not.toContain("需要你在终端里按回车");
  });

  it("is enabled and shows no confirmation until the user asks for it", () => {
    const markup = control(READY);
    expect(markup).toMatch(OPEN_BUTTON_ENABLED);
    expect(markup).not.toContain("工作目录：用户主目录");
  });

  it("asks for confirmation with the full command, the working directory and the Enter step", () => {
    const markup = control(READY, { status: "confirming" });
    expect(markup).toContain("在终端中打开命令");
    expect(markup).toContain("claude --print");
    expect(markup).toContain("工作目录：用户主目录（未选择项目目录）。");
    expect(markup).toContain("需要你在终端里按回车才会运行；UserHome 不会运行或读取输出。");
    expect(markup).toContain("在 Terminal 中打开");
    expect(markup).not.toContain("占位符需要你在终端环境中已设置");
  });

  it("warns that placeholders must already be set in the terminal environment", () => {
    const markup = control({ status: "ready", built: SECRET_BUILT }, { status: "confirming" });
    expect(markup).toContain("占位符需要你在终端环境中已设置");
    expect(markup).toContain("在此填入，勿提交");
  });

  it("locks the confirm button while the open is in flight", () => {
    const markup = control(READY, { status: "opening" });
    expect(markup).toMatch(CONFIRM_BUTTON_DISABLED);
  });

  it("confirms that Terminal was opened without claiming the command ran", () => {
    const markup = control(READY, { status: "opened" });
    expect(markup).toContain("已在 Terminal 中打开命令");
    expect(markup).toContain("UserHome 不会运行或读取输出");
    expect(markup).not.toContain("在终端中打开命令");
  });

  it("shows a failure from the backend as an alert and keeps the button available", () => {
    const markup = control(READY, {
      status: "failed",
      error: { code: "PROCESS_FAILED", message: "无法在 Terminal 中打开命令。", retryable: true } as AppError,
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("无法在 Terminal 中打开命令。");
    expect(markup).toMatch(OPEN_BUTTON_ENABLED);
  });
});
