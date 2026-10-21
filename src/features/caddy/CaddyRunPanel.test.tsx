import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyRunStatus, CaddyStartSummary } from "../../ipc/caddy";
import { initialLogView } from "./caddyRunModel";
import { CaddyRunView, type CaddyRunViewProps } from "./CaddyRunPanel";

const NOOP = () => undefined;

const STOPPED: CaddyRunStatus = {
  state: "STOPPED",
  message: "未运行。",
  diagnostics: [],
};

const RUNNING: CaddyRunStatus = {
  state: "RUNNING",
  message: "运行中：进程存活且管理端点已就绪。",
  diagnostics: [],
  sessionId: "s-1",
  source: "RULES",
};

const FAILED: CaddyRunStatus = {
  state: "FAILED",
  failure: "CONFIG_REJECTED",
  message: "配置未通过校验，未启动。",
  diagnostics: [{ line: 2, message: "unrecognized directive: reverse_prox" }],
};

const READY: CaddyStartSummary = {
  planId: "7f0c9a2e-1b3d-4c5e-8f60-123456789abc",
  source: "RULES",
  executablePath: "/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy",
  version: "v2.8.4 h1:fixture",
  workingDirectory: "<私有运行目录>",
  configFingerprint: "0123456789abcdef",
  listen: ["http://127.0.0.1:8080"],
  upstreams: ["http://127.0.0.1:3000"],
  adminEndpoint: "仅本次运行的私有 Unix socket（不占用默认 localhost:2019）",
  notes: ["以前台 caddy run 启动本应用持有的自有实例。"],
};

const BLOCKED: CaddyStartSummary = {
  source: "RAW",
  workingDirectory: "<私有运行目录>",
  configFingerprint: "0123456789abcdef",
  listen: [],
  upstreams: [],
  adminEndpoint: "仅本次运行的私有 Unix socket（不占用默认 localhost:2019）",
  notes: [],
  blocked: "原文已包含 admin 全局选项：本应用不会覆盖或替换它。",
};

function view(overrides: Partial<CaddyRunViewProps> = {}): string {
  const props: CaddyRunViewProps = {
    source: "RULES",
    status: STOPPED,
    busy: false,
    logs: initialLogView(undefined),
    paused: false,
    onPrepare: NOOP,
    onStart: NOOP,
    onCancelSummary: NOOP,
    onStop: NOOP,
    onPauseChange: NOOP,
    ...overrides,
  };
  return renderToStaticMarkup(<CaddyRunView {...props} />);
}

function button(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<button[^>]*>${label}</button>`));
  if (match === null) throw new Error(`button not found: ${label}`);
  return match[0];
}

function isDisabled(markup: string, label: string): boolean {
  return / disabled=""/.test(button(markup, label));
}

describe("run state rendering", () => {
  it("shows the state with a symbol and text, not colour alone", () => {
    expect(view({ status: RUNNING })).toContain("● 运行中");
    expect(view({ status: FAILED })).toContain("▲ 失败");
    expect(view({ status: STOPPED })).toContain("○ 已停止");
  });

  it("does not show running for a status that is not running", () => {
    const starting = view({
      status: { state: "STARTING", message: "正在开启，等待管理端点就绪……", diagnostics: [] },
    });
    expect(starting).not.toContain("运行中");
    expect(starting).toContain("正在开启");
  });

  it("shows the reason and diagnostics of a failure as an alert", () => {
    const markup = view({ status: FAILED });
    expect(markup).toMatch(/role="alert"[^>]*>[\s\S]*配置未通过校验/);
    expect(markup).toContain("unrecognized directive: reverse_prox");
    expect(markup).toContain("第 2 行");
  });

  it("states that a failure is not retried automatically when it is shown", () => {
    expect(view({ status: FAILED })).toContain("未自动重试");
  });
});

describe("run action buttons", () => {
  it("enables preview and disables stop while stopped", () => {
    const markup = view({ status: STOPPED });
    expect(isDisabled(markup, "开启前预览")).toBe(false);
    expect(isDisabled(markup, "关闭")).toBe(true);
  });

  it("disables preview and enables stop while running", () => {
    const markup = view({ status: RUNNING });
    expect(isDisabled(markup, "开启前预览")).toBe(true);
    expect(isDisabled(markup, "关闭")).toBe(false);
  });

  it("disables every action while a request is in flight", () => {
    const markup = view({ status: STOPPED, busy: true, summary: READY });
    expect(isDisabled(markup, "开启前预览")).toBe(true);
    expect(isDisabled(markup, "确认开启")).toBe(true);
    expect(isDisabled(markup, "关闭")).toBe(true);
  });

  it("disables stop while stopping, and keeps preview unavailable", () => {
    const markup = view({
      status: { state: "STOPPING", message: "正在停止，等待进程退出……", diagnostics: [] },
    });
    expect(isDisabled(markup, "关闭")).toBe(true);
    expect(isDisabled(markup, "开启前预览")).toBe(true);
  });
});

describe("start summary confirmation", () => {
  it("shows the previewed facts and asks for an explicit confirmation", () => {
    const markup = view({ summary: READY });
    expect(markup).toContain("/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy");
    expect(markup).toContain("http://127.0.0.1:8080");
    expect(markup).toContain("http://127.0.0.1:3000");
    expect(markup).toContain("私有运行目录");
    expect(isDisabled(markup, "确认开启")).toBe(false);
    expect(isDisabled(markup, "取消")).toBe(false);
  });

  it("offers no confirmation for a blocked summary and says why", () => {
    const markup = view({ summary: BLOCKED });
    expect(markup).toContain("原文已包含 admin 全局选项");
    expect(markup).not.toContain("确认开启");
  });

  it("says that raw listen and upstream addresses are read from the text", () => {
    const markup = view({
      source: "RAW",
      summary: { ...READY, source: "RAW", listen: [], upstreams: [] },
    });
    expect(markup).toContain("以原文为准");
  });
});

describe("run logs", () => {
  it("renders the bounded log viewer under a clear label", () => {
    const markup = view({
      logs: {
        sessionId: "s-1",
        stdoutOffset: 6,
        stderrOffset: 0,
        stdoutCarry: "",
        stderrCarry: "",
        lines: ["[out] hello"],
        dropped: 3,
      },
    });
    expect(markup).toContain("Caddy 日志");
    expect(markup).toContain("[out] hello");
  });
});
