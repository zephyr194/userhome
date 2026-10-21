import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  LAUNCHD_ACTIONS,
  decodeLaunchdActionExecution,
  decodeLaunchdActionPreview,
  executeLaunchdAction,
  previewLaunchdAction,
  type LaunchdActionRequest,
} from "./services";

const LABEL = "com.zephyr194.userhome.agent.backup";
const TARGET = `gui/501/${LABEL}`;

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: `停止任务 ${LABEL}`,
    effects: ["将从 launchd 卸载"],
    requiresElevation: false,
    expiresAt: "2026-10-20T10:05:00Z",
    action: "STOP",
    domain: "GUI",
    label: LABEL,
    meaning: ["将从 launchd 卸载（launchctl bootout），之后不会被自动拉起。"],
    persistence: ["配置文件保留；下次登录时仍会自动加载。"],
    commands: [`launchctl bootout ${TARGET}`],
    current: { loaded: true, running: true, pid: 700, disabled: null },
    keepAlive: true,
    noChange: false,
    ...overrides,
  };
}

function wireOperation(status: string, overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: `停止任务 ${LABEL}`,
    effects: [],
    requiresElevation: false,
    expiresAt: "2026-10-20T10:05:00Z",
    status,
    events: [],
    ...overrides,
  };
}

function wireExecution(overrides: Record<string, unknown> = {}) {
  return {
    operation: wireOperation("SUCCEEDED"),
    action: "STOP",
    domain: "GUI",
    label: LABEL,
    outcome: "SUCCEEDED",
    message: "已完成，并已通过回读确认：任务已从 launchd 卸载。",
    steps: [
      {
        command: `launchctl bootout ${TARGET}`,
        status: "SUCCEEDED",
        exitCode: null,
        detail: null,
      },
    ],
    expected: { loaded: false },
    observed: { loaded: false, running: false, pid: null, disabled: null },
    cancelRequested: false,
    ...overrides,
  };
}

const REQUEST: LaunchdActionRequest = {
  action: "STOP",
  domain: "GUI",
  label: LABEL,
};

afterEach(() => {
  clearMocks();
});

describe("launchd action preview decoding", () => {
  it("decodes a preview and treats null state parts as unread", () => {
    const preview = decodeLaunchdActionPreview(wirePreview());
    expect(preview).toMatchObject({
      operationId: "op-1",
      action: "STOP",
      domain: "GUI",
      label: LABEL,
      keepAlive: true,
      noChange: false,
      commands: [`launchctl bootout ${TARGET}`],
      current: { loaded: true, running: true, pid: 700 },
    });
    expect(preview.current.disabled).toBeUndefined();
  });

  it("decodes a no-change preview with no command", () => {
    const preview = decodeLaunchdActionPreview(
      wirePreview({ action: "LOAD", commands: [], noChange: true }),
    );
    expect(preview.commands).toEqual([]);
    expect(preview.noChange).toBe(true);
  });

  it("refuses malformed or contradictory previews", () => {
    const bad: Record<string, unknown>[] = [
      { action: "DELETE" },
      { action: "kill" },
      { action: 3 },
      { domain: "SYSTEM" },
      { domain: "gui" },
      { label: "" },
      { label: "a b" },
      { label: "a/b" },
      { label: "-k" },
      { label: "x".repeat(256) },
      { label: `${LABEL}\n` },
      { meaning: [] },
      { meaning: "text" },
      { meaning: Array.from({ length: 9 }, (_, index) => `m${index}`) },
      { persistence: [] },
      { commands: ["rm -rf /"] },
      { commands: ["launchctl remove x"] },
      { commands: ["launchctl load -w x.plist"] },
      { commands: ["launchctl bootout a", "launchctl bootout b"] },
      { commands: "launchctl bootout x" },
      // Commands and the no-change flag must agree.
      { commands: [] },
      { noChange: true },
      { noChange: "no" },
      { keepAlive: "yes" },
      { requiresElevation: true },
      { current: null },
      { current: { loaded: "yes" } },
      { current: { loaded: false, running: true } },
      { current: { pid: 5 } },
      { current: { loaded: true, running: false, pid: 5 } },
      { current: { loaded: true, running: true, pid: -1 } },
      { operationId: 5 },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeLaunchdActionPreview(wirePreview(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
    expect(() => decodeLaunchdActionPreview(null)).toThrow();
    expect(() => decodeLaunchdActionPreview("x")).toThrow();
  });
});

describe("launchd action execution decoding", () => {
  it("decodes a confirmed success", () => {
    const execution = decodeLaunchdActionExecution(wireExecution());
    expect(execution).toMatchObject({
      action: "STOP",
      outcome: "SUCCEEDED",
      label: LABEL,
      cancelRequested: false,
      expected: { loaded: false },
      observed: { loaded: false, running: false },
    });
    expect(execution.steps[0]).toMatchObject({ status: "SUCCEEDED" });
    expect(execution.operation.status).toBe("SUCCEEDED");
  });

  it("decodes partial, failed, unknown, cancelled and no-change results", () => {
    const partial = decodeLaunchdActionExecution(
      wireExecution({
        outcome: "PARTIAL",
        operation: wireOperation("FAILED"),
        expected: { loaded: true, running: false },
        observed: { loaded: true, running: true, pid: 700 },
      }),
    );
    expect(partial.outcome).toBe("PARTIAL");

    const failed = decodeLaunchdActionExecution(
      wireExecution({
        outcome: "FAILED",
        operation: wireOperation("FAILED"),
        steps: [
          {
            command: `launchctl bootout ${TARGET}`,
            status: "FAILED",
            exitCode: 5,
            detail: "Boot-out failed: 5: Input/output error",
          },
        ],
        observed: { loaded: true, running: true, pid: 700 },
      }),
    );
    expect(failed.steps[0]).toMatchObject({ exitCode: 5 });

    const unknown = decodeLaunchdActionExecution(
      wireExecution({
        outcome: "UNKNOWN",
        operation: wireOperation("FAILED"),
        observed: { loaded: null, running: null, pid: null, disabled: null },
      }),
    );
    expect(unknown.observed).toEqual({});

    const cancelled = decodeLaunchdActionExecution(
      wireExecution({
        outcome: "CANCELLED",
        operation: wireOperation("CANCELLED"),
        steps: [{ command: `launchctl bootout ${TARGET}`, status: "NOT_RUN" }],
        cancelRequested: true,
      }),
    );
    expect(cancelled.cancelRequested).toBe(true);

    const same = decodeLaunchdActionExecution(
      wireExecution({
        outcome: "NO_CHANGE",
        steps: [],
        observed: { loaded: false, running: false },
      }),
    );
    expect(same.outcome).toBe("NO_CHANGE");
  });

  it("refuses a success the read-back does not support", () => {
    const bad: Record<string, unknown>[] = [
      // Promised unloaded, but the read-back shows it loaded.
      { observed: { loaded: true, running: true, pid: 9 } },
      // Promised unloaded, but nothing was read back at all.
      { observed: { loaded: null, running: null, pid: null, disabled: null } },
      // A step that did not succeed cannot be a success.
      {
        steps: [
          { command: `launchctl bootout ${TARGET}`, status: "FAILED", exitCode: 5 },
        ],
      },
      { steps: [] },
      // The history must agree.
      { operation: wireOperation("FAILED") },
      { operation: wireOperation("CANCELLED") },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeLaunchdActionExecution(wireExecution(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
  });

  it("refuses an unknown result that claims to know the state matched", () => {
    expect(() =>
      decodeLaunchdActionExecution(
        wireExecution({
          outcome: "UNKNOWN",
          operation: wireOperation("FAILED"),
          // Read back exactly as promised: that is a success, not "unknown".
          observed: { loaded: false, running: false },
        }),
      ),
    ).toThrow();
  });

  it("refuses contradictory or malformed results", () => {
    const bad: Record<string, unknown>[] = [
      { outcome: "DONE" },
      { outcome: "NO_CHANGE", operation: wireOperation("FAILED") },
      { outcome: "NO_CHANGE" }, // still has a step
      { outcome: "PARTIAL" }, // history says succeeded
      { outcome: "CANCELLED", operation: wireOperation("CANCELLED") }, // step ran
      { action: "REMOVE" },
      { domain: "SYSTEM" },
      { label: "a b" },
      { message: "" },
      { steps: "none" },
      { steps: Array.from({ length: 5 }, () => ({ command: "launchctl bootout x", status: "SUCCEEDED" })) },
      { steps: [{ command: "launchctl bootout x", status: "DONE" }] },
      { steps: [{ command: "launchctl bootout x", status: "FAILED", exitCode: 999 }] },
      { observed: "loaded" },
      { observed: { loaded: false, running: true } },
      { expected: null },
      { cancelRequested: "no" },
      { operation: null },
      { operation: { operationId: "op-1" } },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeLaunchdActionExecution(wireExecution(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
    expect(() => decodeLaunchdActionExecution(null)).toThrow();
  });
});

describe("launchd action commands", () => {
  it("sends only the typed action, domain and label", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return wirePreview();
    });

    const preview = await previewLaunchdAction({
      ...REQUEST,
      // A caller cannot smuggle a path, a uid or launchctl arguments in.
      ...({ plistPath: "/etc/x.plist", uid: 0, args: ["-w"] } as object),
    } as LaunchdActionRequest);

    expect(preview.label).toBe(LABEL);
    expect(seen?.command).toBe("preview_launchd_action");
    expect(seen?.payload).toEqual({
      input: { action: "STOP", domain: "GUI", label: LABEL },
    });
  });

  it("refuses a request outside the allow list before any command is sent", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wirePreview();
    });
    const bad: unknown[] = [
      { ...REQUEST, action: "DELETE" },
      { ...REQUEST, action: "KILL" },
      { ...REQUEST, domain: "SYSTEM" },
      { ...REQUEST, domain: "USER" },
      { ...REQUEST, label: "" },
      { ...REQUEST, label: "a/b" },
      { ...REQUEST, label: "-k" },
      { ...REQUEST, label: "a b" },
      { ...REQUEST, label: 5 },
      null,
      "STOP",
    ];
    for (const request of bad) {
      await expect(
        previewLaunchdAction(request as LaunchdActionRequest),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(called).toBe(false);
  });

  it("covers exactly the seven allow-listed actions", () => {
    expect([...LAUNCHD_ACTIONS]).toEqual([
      "LOAD",
      "START",
      "STOP",
      "RESTART",
      "DISABLE",
      "ENABLE",
      "UNLOAD",
    ]);
  });

  it("does not trust a preview for another action or job", async () => {
    for (const overrides of [
      { action: "UNLOAD" },
      { label: "com.zephyr194.userhome.agent.other" },
    ]) {
      mockIPC(() => wirePreview(overrides));
      await expect(previewLaunchdAction(REQUEST)).rejects.toBeDefined();
      clearMocks();
    }
  });

  it("confirms by operation id only and checks the answer is for it", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return wireExecution();
    });
    const execution = await executeLaunchdAction("op-1");
    expect(execution.outcome).toBe("SUCCEEDED");
    expect(seen).toEqual({
      command: "execute_launchd_action",
      payload: { operationId: "op-1" },
    });

    clearMocks();
    mockIPC(() => wireExecution());
    await expect(executeLaunchdAction("another-op")).rejects.toBeDefined();
    await expect(executeLaunchdAction("")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("passes a backend refusal through as a typed error", async () => {
    mockIPC(() => {
      throw {
        code: "PERMISSION_DENIED",
        message: "This launchd service is read-only (APPLE_MANAGED: APPLE_MANAGED).",
        retryable: false,
      };
    });
    await expect(previewLaunchdAction(REQUEST)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});
