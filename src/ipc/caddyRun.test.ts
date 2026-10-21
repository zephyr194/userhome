import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  caddyLogs,
  caddyPrepareStart,
  caddyStart,
  caddyStatus,
  caddyStop,
  decodeLogPage,
  decodeRunStatus,
  decodeStartSummary,
} from "./caddy";

afterEach(() => {
  clearMocks();
});

function expectInternal(decode: () => unknown) {
  let thrown: unknown;
  try {
    decode();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toEqual({
    code: "INTERNAL",
    message: "An internal error occurred.",
    retryable: false,
  });
}

function statusWire(overrides: Record<string, unknown> = {}) {
  return {
    state: "STOPPED",
    message: "未运行。",
    diagnostics: [],
    ...overrides,
  };
}

function summaryWire(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function logWire(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s-1",
    stdout: "hello\n",
    stderr: "",
    stdoutOffset: 6,
    stderrOffset: 0,
    hasMore: false,
    ...overrides,
  };
}

describe("caddy run status decoding", () => {
  it("decodes a stopped status with no session", () => {
    expect(decodeRunStatus(statusWire())).toEqual({
      state: "STOPPED",
      message: "未运行。",
      diagnostics: [],
    });
  });

  it("decodes a running status with its session and source", () => {
    expect(
      decodeRunStatus(
        statusWire({
          state: "RUNNING",
          message: "运行中：进程存活且管理端点已就绪。",
          sessionId: "s-1",
          source: "RAW",
        }),
      ),
    ).toMatchObject({ state: "RUNNING", sessionId: "s-1", source: "RAW" });
  });

  it("decodes a failure with its kind, diagnostics and exit facts", () => {
    expect(
      decodeRunStatus(
        statusWire({
          state: "FAILED",
          message: "Caddy 在运行后意外退出，未自动重启。",
          failure: "CRASHED_AFTER_READY",
          diagnostics: [{ line: 2, message: "unrecognized directive" }],
          sessionId: "s-1",
          source: "RULES",
          exitCode: 3,
        }),
      ),
    ).toMatchObject({
      state: "FAILED",
      failure: "CRASHED_AFTER_READY",
      diagnostics: [{ line: 2, message: "unrecognized directive" }],
      exitCode: 3,
    });
  });

  it("fails closed when a failed status has no failure kind, or a kind on another state", () => {
    expectInternal(() => decodeRunStatus(statusWire({ state: "FAILED" })));
    expectInternal(() =>
      decodeRunStatus(statusWire({ state: "RUNNING", failure: "CONFIG_REJECTED" })),
    );
  });

  it("fails closed on an unknown state, failure kind or source", () => {
    expectInternal(() => decodeRunStatus(statusWire({ state: "ONLINE" })));
    expectInternal(() =>
      decodeRunStatus(statusWire({ state: "FAILED", failure: "SOMETHING_ELSE" })),
    );
    expectInternal(() => decodeRunStatus(statusWire({ source: "PATH" })));
  });

  it("fails closed on a stray field, a missing message or a non-array diagnostics", () => {
    expectInternal(() => decodeRunStatus(statusWire({ path: "/bin/sh" })));
    expectInternal(() => decodeRunStatus({ state: "STOPPED", diagnostics: [] }));
    expectInternal(() => decodeRunStatus(statusWire({ diagnostics: "none" })));
  });

  it("rejects a non-object payload", () => {
    expectInternal(() => decodeRunStatus("RUNNING"));
  });
});

describe("caddy start summary decoding", () => {
  it("decodes a summary that carries a plan id and the previewed facts", () => {
    expect(decodeStartSummary(summaryWire())).toMatchObject({
      planId: "7f0c9a2e-1b3d-4c5e-8f60-123456789abc",
      source: "RULES",
      listen: ["http://127.0.0.1:8080"],
      upstreams: ["http://127.0.0.1:3000"],
    });
  });

  it("decodes a blocked summary that carries no plan and no executable", () => {
    const summary = decodeStartSummary({
      source: "RAW",
      workingDirectory: "<私有运行目录>",
      configFingerprint: "0123456789abcdef",
      listen: [],
      upstreams: [],
      adminEndpoint: "仅本次运行的私有 Unix socket（不占用默认 localhost:2019）",
      notes: [],
      blocked: "原文已包含 admin 全局选项。",
    });
    expect(summary).toMatchObject({ source: "RAW", blocked: "原文已包含 admin 全局选项。" });
    expect(summary.planId).toBeUndefined();
  });

  it("fails closed when a summary has both a plan and a block, or neither", () => {
    expectInternal(() => decodeStartSummary(summaryWire({ blocked: "阻止" })));
    const neither = summaryWire();
    delete (neither as Record<string, unknown>).planId;
    expectInternal(() => decodeStartSummary(neither));
  });

  it("fails closed when a plan has no executable path or version", () => {
    expectInternal(() => decodeStartSummary(summaryWire({ executablePath: undefined })));
    expectInternal(() => decodeStartSummary(summaryWire({ version: undefined })));
  });

  it("fails closed on an unknown source or a stray path field", () => {
    expectInternal(() => decodeStartSummary(summaryWire({ source: "FILE" })));
    expectInternal(() => decodeStartSummary(summaryWire({ configPath: "/x" })));
  });
});

describe("caddy log page decoding", () => {
  it("decodes a page with its text and cursors", () => {
    expect(decodeLogPage(logWire())).toEqual({
      sessionId: "s-1",
      stdout: "hello\n",
      stderr: "",
      stdoutOffset: 6,
      stderrOffset: 0,
      hasMore: false,
    });
  });

  it("fails closed on a negative or non-integer cursor and on a stray field", () => {
    expectInternal(() => decodeLogPage(logWire({ stdoutOffset: -1 })));
    expectInternal(() => decodeLogPage(logWire({ stderrOffset: 1.5 })));
    expectInternal(() => decodeLogPage(logWire({ file: "/tmp/x" })));
  });
});

describe("caddy run command requests", () => {
  it("prepares a start from the source only, with no path", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_prepare_start");
      expect(payload).toEqual({ input: { source: "RULES" } });
      expect(JSON.stringify(payload)).not.toMatch(/path|caddyfile/i);
      return summaryWire();
    });

    await expect(caddyPrepareStart("RULES")).resolves.toMatchObject({ source: "RULES" });
  });

  it("starts only with the plan id, its source and an explicit confirmation", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_start");
      expect(payload).toEqual({
        input: {
          planId: "7f0c9a2e-1b3d-4c5e-8f60-123456789abc",
          source: "RAW",
          confirmed: true,
        },
      });
      return statusWire({ state: "STARTING", message: "正在开启，等待管理端点就绪……" });
    });

    await expect(
      caddyStart("7f0c9a2e-1b3d-4c5e-8f60-123456789abc", "RAW"),
    ).resolves.toMatchObject({ state: "STARTING" });
  });

  it("stops and reads status without sending arguments", async () => {
    const seen: string[] = [];
    mockIPC((command) => {
      seen.push(command);
      return statusWire();
    });

    await caddyStop();
    await caddyStatus();
    expect(seen).toEqual(["caddy_stop", "caddy_status"]);
  });

  it("reads logs with the session id and two cursors only", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_logs");
      expect(payload).toEqual({
        input: { sessionId: "s-1", stdoutOffset: 6, stderrOffset: 0 },
      });
      return logWire({ stdoutOffset: 6 });
    });

    await expect(caddyLogs("s-1", 6, 0)).resolves.toMatchObject({ sessionId: "s-1" });
  });
});
