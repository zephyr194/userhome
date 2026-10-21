import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CaddyConflictReport,
  CaddyRunStatus,
  CaddyStartSummary,
} from "../../ipc/caddy";
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

const CONFLICT_BLOCKED: CaddyConflictReport = {
  verdict: "BLOCKED",
  headline: "发现冲突，已拒绝开启。",
  blocks: ["EXTERNAL_RUNNING", "PORT_OCCUPIED"],
  external: {
    snapshot: "COMPLETE",
    explanation: "已读取常驻 Caddy 任务快照，且快照完整。",
    instances: [
      {
        label: "homebrew.mxcl.caddy",
        domain: "GUI",
        runState: "RUNNING",
        pid: 77,
        explanation: "外部常驻 Caddy 正在运行。本应用不会停止、重载或接管它。",
      },
    ],
  },
  ports: [
    {
      host: "127.0.0.1",
      port: 8080,
      state: "OCCUPIED",
      occupant: { name: "caddy", pid: 77 },
      explanation: "已被进程 caddy（pid 77）占用，无法绑定，已拒绝开启。",
    },
  ],
  upstreams: [
    {
      host: "127.0.0.1",
      port: 3000,
      state: "UNREACHABLE",
      explanation: "上游不可达。这只是提示，不等于代理进程未运行。",
    },
  ],
  notes: [],
};

const CLEAR_CONFLICTS: CaddyConflictReport = {
  verdict: "CLEAR",
  headline: "未发现冲突，不保证绑定成功。",
  blocks: [],
  external: { snapshot: "COMPLETE", explanation: "快照完整。", instances: [] },
  ports: [
    {
      host: "127.0.0.1",
      port: 8080,
      state: "FREE",
      explanation: "预检查未发现该地址有监听（不保证绑定成功）。",
    },
  ],
  upstreams: [],
  notes: [],
};

const UNCONFIRMED_CONFLICTS: CaddyConflictReport = {
  ...CLEAR_CONFLICTS,
  verdict: "UNCONFIRMED",
  headline: "有项目无法确认，开启需你显式确认。",
  external: {
    snapshot: "UNREADABLE",
    explanation: "无法读取常驻任务快照，无法确认外部 Caddy 状态，需你确认后才能开启。",
    instances: [],
  },
};

describe("conflict report in the start summary", () => {
  it("shows the external owner, the occupied port with its occupant and an upstream note", () => {
    const markup = view({
      summary: { ...READY, conflicts: CONFLICT_BLOCKED, blocked: undefined },
    });
    expect(markup).toContain("发现冲突，已拒绝开启。");
    expect(markup).toContain("homebrew.mxcl.caddy");
    expect(markup).toContain("外部常驻 Caddy 正在运行");
    expect(markup).toContain("已被进程 caddy（pid 77）占用");
    expect(markup).toContain("上游不可达");
    expect(markup).toContain("不等于代理进程未运行");
  });

  it("disables confirmation for a conflict and offers no acceptance checkbox", () => {
    const markup = view({ summary: { ...READY, conflicts: CONFLICT_BLOCKED } });
    expect(isDisabled(markup, "确认开启")).toBe(true);
    expect(markup).not.toContain("我已确认");
  });

  it("offers a jump to the external service only when an external instance blocks", () => {
    expect(view({ summary: { ...READY, conflicts: CONFLICT_BLOCKED } })).toContain(
      "查看该服务",
    );
    const portOnly = view({
      summary: {
        ...READY,
        conflicts: {
          ...CONFLICT_BLOCKED,
          blocks: ["PORT_OCCUPIED"],
          external: { ...CONFLICT_BLOCKED.external, instances: [] },
        },
      },
    });
    expect(portOnly).not.toContain("查看该服务");
  });

  it("reports a clear check as not a guarantee of binding and never as an available port", () => {
    const markup = view({ summary: { ...READY, conflicts: CLEAR_CONFLICTS } });
    expect(markup).toContain("未发现冲突，不保证绑定成功。");
    expect(markup).not.toContain("端口可用");
    expect(isDisabled(markup, "确认开启")).toBe(false);
  });

  it("requires an explicit acceptance before starting an unconfirmed state", () => {
    const markup = view({ summary: { ...READY, conflicts: UNCONFIRMED_CONFLICTS } });
    expect(markup).toContain("无法读取常驻任务快照");
    expect(markup).toContain("我已确认");
    expect(isDisabled(markup, "确认开启")).toBe(true);
  });

  it("states the symbol and label of the verdict, not colour alone", () => {
    expect(view({ summary: { ...READY, conflicts: CONFLICT_BLOCKED } })).toContain("✕ 发现冲突");
    expect(view({ summary: { ...READY, conflicts: CLEAR_CONFLICTS } })).toContain("✓ 未发现冲突");
    expect(view({ summary: { ...READY, conflicts: UNCONFIRMED_CONFLICTS } })).toContain("! 需要确认");
  });
});

const PENDING_RUNNING: CaddyRunStatus & { applied: "PENDING"; applying: false } = {
  ...RUNNING,
  applied: "PENDING",
  applying: false,
};

describe("pending saved config while running", () => {
  it("shows an unapplied badge with a symbol and text when the saved config differs", () => {
    expect(view({ status: PENDING_RUNNING })).toContain("△ 未应用");
  });

  it("does not show the unapplied badge once the running config matches", () => {
    expect(view({ status: { ...RUNNING, applied: "APPLIED", applying: false } })).not.toContain(
      "未应用",
    );
  });

  it("enables apply only for a running instance with a pending saved config", () => {
    const label = "应用到运行中的实例";
    expect(isDisabled(view({ status: PENDING_RUNNING, onApply: NOOP }), label)).toBe(false);
    expect(isDisabled(view({ status: STOPPED, onApply: NOOP }), label)).toBe(true);
    expect(
      isDisabled(
        view({ status: { ...RUNNING, applied: "APPLIED", applying: false }, onApply: NOOP }),
        label,
      ),
    ).toBe(true);
    expect(isDisabled(view({ status: PENDING_RUNNING, onApply: NOOP, busy: true }), label)).toBe(
      true,
    );
    expect(
      isDisabled(view({ status: { ...PENDING_RUNNING, applying: true }, onApply: NOOP }), label),
    ).toBe(true);
  });

  it("asks for an explicit confirmation that says the old config may keep running", () => {
    const markup = view({
      status: PENDING_RUNNING,
      confirmingApply: true,
      onConfirmApply: NOOP,
      onCancelApply: NOOP,
    });
    expect(markup).toContain("确认应用到运行中的实例");
    expect(markup).toContain("失败时旧配置可能仍在运行");
    expect(button(markup, "确认应用")).toBeTruthy();
  });

  it("shows applying progress while the reload is in flight", () => {
    expect(view({ status: PENDING_RUNNING, applying: true })).toContain("正在应用");
  });

  it("reports a successful apply only with its review", () => {
    const markup = view({
      status: { ...RUNNING, applied: "APPLIED", applying: false },
      applyResult: {
        sessionId: "s-1",
        outcome: "SUCCEEDED",
        message: "已重载并复核通过：进程存活、管理端点可连接，活动配置已记录为新版本。",
        review: { alive: true, adminReachable: true, config: "CANDIDATE" },
        diagnostics: [],
      },
    });
    expect(markup).toContain("应用成功（已复核）");
    expect(markup).toContain("活动配置已记录为新版本");
    expect(markup).not.toContain("应用未成功");
  });

  it("reports a failed reload with its category, the review and that the old config may still run", () => {
    const markup = view({
      status: PENDING_RUNNING,
      applyResult: {
        sessionId: "s-1",
        outcome: "FAILED",
        failure: "COMMAND_FAILED",
        message: "重载命令失败。进程存活且管理端点可连接，旧配置仍是记录中的活动配置。",
        review: { alive: true, adminReachable: true, config: "PREVIOUS" },
        diagnostics: [{ message: "Error: loading new config" }],
      },
    });
    expect(markup).toContain("应用未成功：命令失败");
    expect(markup).toContain("管理端点可连接");
    expect(markup).toContain("活动配置仍为旧版本");
    expect(markup).toContain("Error: loading new config");
    expect(markup).toContain("未自动重试");
  });

  it("states that a review failure is not a success and leaves the instance state unknown", () => {
    const markup = view({
      status: PENDING_RUNNING,
      applyResult: {
        sessionId: "s-1",
        outcome: "FAILED",
        failure: "REVIEW_FAILED",
        message: "重载命令已返回成功，但复核未通过，不能确认实例状态，不宣称成功。",
        review: { alive: true, adminReachable: false, config: "UNKNOWN" },
        diagnostics: [],
      },
    });
    expect(markup).toContain("应用未成功：复核失败");
    expect(markup).toContain("活动配置未知");
    expect(markup).not.toContain("应用成功");
  });
});
