import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCHD_ACTIONS,
  type LaunchdAction,
  type LaunchdActionExecution,
  type LaunchdActionPreview,
  type LaunchdService,
} from "../../ipc/services";
import {
  ACTION_HINTS,
  ACTION_LABELS,
  actionLabel,
  actionPanelReducer,
  availableActions,
  findCreatedService,
  findServiceByFocus,
  INITIAL_ACTION_PANEL_STATE,
  isActionable,
  noActionsReason,
  observedLines,
  presentOutcome,
  type ActionPanelState,
} from "./launchdActionModel";
import {
  APPLE_OWNERSHIP,
  DAEMON_OWNERSHIP,
  THIRD_PARTY_OWNERSHIP,
  createdService,
  launchdService,
} from "./launchdFixtures";

function created(overrides: Partial<LaunchdService> = {}): LaunchdService {
  return { ...createdService(), ...overrides };
}

describe("available actions", () => {
  it("offers the load, disable and enable actions for an unloaded job", () => {
    expect(
      availableActions(created({ loadState: "NOT_LOADED", runState: "NOT_RUNNING" })),
    ).toEqual(["LOAD", "DISABLE", "ENABLE"]);
  });

  it("offers start only while nothing runs, and never load for a loaded job", () => {
    const idle = availableActions(
      created({ loadState: "LOADED", runState: "NOT_RUNNING" }),
    );
    expect(idle).toEqual(["START", "RESTART", "STOP", "UNLOAD", "DISABLE", "ENABLE"]);
    const running = availableActions(
      created({ loadState: "LOADED", runState: "RUNNING", pid: 7 }),
    );
    expect(running).toEqual(["RESTART", "STOP", "UNLOAD", "DISABLE", "ENABLE"]);
    expect(running).not.toContain("LOAD");
  });

  it("offers nothing when the load state is not known", () => {
    for (const loadState of ["UNKNOWN", "INACCESSIBLE"] as const) {
      const service = created({ loadState, runState: "UNKNOWN" });
      expect(availableActions(service)).toEqual([]);
      expect(noActionsReason(service)).toContain("刷新");
    }
    expect(noActionsReason(created({ loadState: "LOADED" }))).toBeUndefined();
  });

  it("offers nothing for any job the backend did not judge modifiable", () => {
    for (const ownership of [
      APPLE_OWNERSHIP,
      DAEMON_OWNERSHIP,
      THIRD_PARTY_OWNERSHIP,
    ]) {
      for (const loadState of ["LOADED", "NOT_LOADED"] as const) {
        const service = launchdService({ ownership, loadState });
        expect(isActionable(service)).toBe(false);
        expect(availableActions(service)).toEqual([]);
      }
    }
    // The plain current-user agent that is not adopted stays read-only too.
    expect(availableActions(launchdService())).toEqual([]);
  });

  it("offers nothing outside the user's session domain, whatever else says", () => {
    const service = created({ domain: "SYSTEM", loadState: "LOADED" });
    expect(availableActions(service)).toEqual([]);
  });

  it("only ever offers the seven allow-listed actions", () => {
    expect([...LAUNCHD_ACTIONS].sort()).toEqual(
      ["DISABLE", "ENABLE", "LOAD", "RESTART", "START", "STOP", "UNLOAD"],
    );
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...LAUNCHD_ACTIONS].sort());
    expect(Object.keys(ACTION_HINTS).sort()).toEqual([...LAUNCHD_ACTIONS].sort());
    for (const loadState of ["LOADED", "NOT_LOADED"] as const) {
      for (const action of availableActions(created({ loadState }))) {
        expect(LAUNCHD_ACTIONS).toContain(action);
      }
    }
    expect(actionLabel("DISABLE")).toBe("禁用自启");
  });
});

describe("outcome wording", () => {
  it("separates success, partial and unknown, and asks for a refresh when unsure", () => {
    expect(presentOutcome("SUCCEEDED")).toMatchObject({ label: "成功", needsRefresh: false });
    expect(presentOutcome("NO_CHANGE")).toMatchObject({ label: "无需变更", needsRefresh: false });
    expect(presentOutcome("PARTIAL")).toMatchObject({ label: "部分完成", needsRefresh: true });
    expect(presentOutcome("UNKNOWN")).toMatchObject({ label: "未知", tone: "warning", needsRefresh: true });
    expect(presentOutcome("FAILED")).toMatchObject({ label: "失败", needsRefresh: true });
    expect(presentOutcome("CANCELLED")).toMatchObject({ label: "已取消", needsRefresh: false });
  });

  it("never words an unread state as stopped, unloaded or enabled", () => {
    const lines = observedLines({});
    expect(lines).toEqual(["加载：未知", "进程：未知", "登录自动启动：未知"]);
    for (const text of ["已停止", "未加载", "没有运行中的进程", "已禁用", "已启用"]) {
      expect(lines.join("|")).not.toContain(text);
    }
    expect(
      observedLines({ loaded: true, running: true, pid: 42, disabled: false }),
    ).toEqual(["加载：已加载", "进程：有运行中的进程（PID 42）", "登录自动启动：已启用"]);
    expect(observedLines({ loaded: false, running: false, disabled: true })).toEqual([
      "加载：未加载",
      "进程：没有运行中的进程",
      "登录自动启动：已禁用",
    ]);
  });
});

describe("finding a service named by another page", () => {
  it("matches by label and domain and never by label alone", () => {
    const user = launchdService({ label: "homebrew.mxcl.caddy", id: "gui/501/homebrew.mxcl.caddy", domain: "GUI" });
    const system = launchdService({ label: "homebrew.mxcl.caddy", id: "system/homebrew.mxcl.caddy", domain: "SYSTEM" });
    expect(findServiceByFocus([system, user], { label: "homebrew.mxcl.caddy", domain: "GUI" })?.id).toBe(user.id);
    expect(findServiceByFocus([system], { label: "homebrew.mxcl.caddy", domain: "GUI" })).toBeUndefined();
    expect(findServiceByFocus([user], { label: "other", domain: "GUI" })).toBeUndefined();
  });
});

describe("finding a freshly created job", () => {
  it("finds only the modifiable user-session job with that label", () => {
    const job = created({ label: "com.zephyr194.userhome.agent.x", id: "gui/501/com.zephyr194.userhome.agent.x" });
    const other = launchdService({ label: "com.zephyr194.userhome.agent.x", id: "other" });
    expect(findCreatedService([other, job], job.label)?.id).toBe(job.id);
    expect(findCreatedService([other], job.label)).toBeUndefined();
    expect(findCreatedService([job], "missing")).toBeUndefined();
  });
});

// ---- the state machine ------------------------------------------------------

function preview(action: LaunchdAction = "STOP"): LaunchdActionPreview {
  return {
    operationId: "op-1",
    summary: "s",
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    action,
    domain: "GUI",
    label: "com.zephyr194.userhome.agent.x",
    meaning: ["m"],
    persistence: ["p"],
    commands: ["launchctl bootout gui/501/com.zephyr194.userhome.agent.x"],
    current: { loaded: true, running: true, pid: 9 },
    keepAlive: true,
    noChange: false,
  };
}

function execution(): LaunchdActionExecution {
  return {
    operation: {
      operationId: "op-1",
      summary: "s",
      effects: [],
      expiresAt: "2026-10-20T10:05:00Z",
      status: "SUCCEEDED",
      events: [],
    },
    action: "STOP",
    domain: "GUI",
    label: "com.zephyr194.userhome.agent.x",
    outcome: "SUCCEEDED",
    message: "ok",
    steps: [],
    expected: {},
    observed: {},
    cancelRequested: false,
  };
}

const ERROR = { code: "CONFLICT", message: "m", retryable: false } as const;

describe("action panel state machine", () => {
  it("walks idle → previewing → previewed → executing → done", () => {
    let state: ActionPanelState = INITIAL_ACTION_PANEL_STATE;
    state = actionPanelReducer(state, { type: "previewStarted", action: "STOP" });
    expect(state).toEqual({ phase: "previewing", action: "STOP" });
    state = actionPanelReducer(state, { type: "previewed", preview: preview() });
    expect(state.phase).toBe("previewed");
    state = actionPanelReducer(state, { type: "executeStarted" });
    expect(state.phase).toBe("executing");
    state = actionPanelReducer(state, { type: "executed", execution: execution() });
    expect(state.phase).toBe("done");
    expect(actionPanelReducer(state, { type: "dismissed" })).toEqual({ phase: "idle" });
  });

  it("cannot confirm without a shown preview or start a second action in flight", () => {
    expect(actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "executeStarted" })).toEqual(
      INITIAL_ACTION_PANEL_STATE,
    );
    const previewing = actionPanelReducer(INITIAL_ACTION_PANEL_STATE, {
      type: "previewStarted",
      action: "LOAD",
    });
    expect(actionPanelReducer(previewing, { type: "previewStarted", action: "STOP" })).toBe(previewing);
    const executing = actionPanelReducer(
      actionPanelReducer(
        actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "previewStarted", action: "STOP" }),
        { type: "previewed", preview: preview() },
      ),
      { type: "executeStarted" },
    );
    expect(actionPanelReducer(executing, { type: "previewStarted", action: "LOAD" })).toBe(executing);
    expect(actionPanelReducer(executing, { type: "executeStarted" })).toBe(executing);
  });

  it("ignores a result that no longer matches the state", () => {
    expect(
      actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "previewed", preview: preview() }),
    ).toEqual(INITIAL_ACTION_PANEL_STATE);
    expect(
      actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "executed", execution: execution() }),
    ).toEqual(INITIAL_ACTION_PANEL_STATE);
    expect(actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "failed", error: ERROR })).toEqual(
      INITIAL_ACTION_PANEL_STATE,
    );
  });

  it("keeps a request in flight on screen and records where a failure happened", () => {
    const previewing = actionPanelReducer(INITIAL_ACTION_PANEL_STATE, {
      type: "previewStarted",
      action: "RESTART",
    });
    expect(actionPanelReducer(previewing, { type: "dismissed" })).toBe(previewing);
    expect(actionPanelReducer(previewing, { type: "failed", error: ERROR })).toEqual({
      phase: "error",
      during: "preview",
      action: "RESTART",
      error: ERROR,
    });
    const executing = actionPanelReducer(
      actionPanelReducer(
        actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "previewStarted", action: "STOP" }),
        { type: "previewed", preview: preview() },
      ),
      { type: "executeStarted" },
    );
    expect(actionPanelReducer(executing, { type: "dismissed" })).toBe(executing);
    expect(actionPanelReducer(executing, { type: "failed", error: ERROR })).toEqual({
      phase: "error",
      during: "execute",
      action: "STOP",
      error: ERROR,
    });
  });

  it("lets a shown preview be dismissed", () => {
    const shown = actionPanelReducer(
      actionPanelReducer(INITIAL_ACTION_PANEL_STATE, { type: "previewStarted", action: "STOP" }),
      { type: "previewed", preview: preview() },
    );
    expect(actionPanelReducer(shown, { type: "dismissed" })).toEqual({ phase: "idle" });
  });
});

describe("action panel sources stay inside the allow list", () => {
  const directory = join(process.cwd(), "src", "features", "services");
  const source = (name: string) => readFileSync(join(directory, name), "utf8");

  it("names no delete, adopt or batch operation", () => {
    for (const name of ["launchdActionModel.ts", "LaunchdActionPanel.tsx"]) {
      expect(source(name), name).not.toMatch(
        /deleteConfig|removeConfig|adoptService|takeOver|batch|bulk|selectAll|SIGKILL|"DELETE"|"REMOVE"/,
      );
    }
  });

  it("sends only a typed action request and an operation id", () => {
    const panel = source("LaunchdActionPanel.tsx");
    expect(panel).toMatch(/previewLaunchdAction\(/);
    expect(panel).toMatch(/executeLaunchdAction\(/);
    expect(panel).not.toMatch(/plist|uid|launchctl\s+-|argv|invoke\(/i);
  });
});
