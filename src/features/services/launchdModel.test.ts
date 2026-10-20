import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import {
  LAUNCHD_EVIDENCE,
  LAUNCHD_OWNERSHIPS,
  LAUNCHD_READ_ONLY_REASONS,
  type ServiceSummary,
} from "../../ipc/services";
import {
  APPLE_OWNERSHIP,
  CREATED_OWNERSHIP,
  DAEMON_OWNERSHIP,
  THIRD_PARTY_OWNERSHIP,
  configFile,
  createdService,
  launchdService,
  partialDiscovery,
  sampleDiscovery,
  sampleServices,
  sourceReport,
} from "./launchdFixtures";
import {
  DISCOVERY_REFRESH_MIN_INTERVAL_MS,
  EMPTY_FILTER,
  INITIAL_DISCOVERY_STATE,
  canStartRefresh,
  correlationBrief,
  correlationText,
  discoveryReducer,
  domainLabel,
  evidenceFor,
  executionOf,
  exitText,
  filterServices,
  evidenceText,
  isFilterActive,
  moveIndex,
  ownershipDescription,
  ownershipLabel,
  ownershipSummary,
  problemSources,
  readOnlyReasonText,
  resolveSelection,
  scopeLabel,
  sourceReasonText,
  statusCategory,
  statusPresentation,
  type ServiceFilter,
} from "./launchdModel";

const ERROR: AppError = {
  code: "PROCESS_FAILED",
  message: "launchctl 失败",
  retryable: true,
};

function ids(filter: Partial<ServiceFilter>) {
  return filterServices(sampleServices(), { ...EMPTY_FILTER, ...filter }).map(
    (service) => service.label,
  );
}

describe("status presentation", () => {
  it("separates running, idle, not loaded and unknown", () => {
    const [running, idle, notLoaded, , , unmatched] = sampleServices();
    expect(statusCategory(running)).toBe("RUNNING");
    expect(statusCategory(idle)).toBe("LOADED_IDLE");
    expect(statusCategory(notLoaded)).toBe("NOT_LOADED");
    expect(statusCategory(unmatched)).toBe("UNKNOWN");
    expect(
      statusCategory(
        launchdService({ loadState: "INACCESSIBLE", runState: "INACCESSIBLE", pid: undefined }),
      ),
    ).toBe("UNKNOWN");
  });

  it("never treats a stopped or non-zero-exit job as an error", () => {
    const idle = launchdService({
      runState: "NOT_RUNNING",
      pid: undefined,
      lastExit: { kind: "CODE", value: 78 },
    });
    const presentation = statusPresentation(idle);
    expect(presentation.label).toBe("已加载，未运行");
    expect(presentation.tone).toBe("neutral");
    expect(exitText(idle.lastExit)).toBe("退出码 78");
    expect(presentation.label).not.toMatch(/错误|失败|异常/);
    expect(presentation.detail).toContain("不是错误");
  });

  it("says a PID only means a process exists, not that it is healthy", () => {
    const presentation = statusPresentation(launchdService());
    expect(presentation.label).toBe("运行中");
    expect(presentation.detail).toContain("不代表");
    expect(presentation.detail).toContain("健康");
  });

  it("describes signals and missing exits", () => {
    expect(exitText({ kind: "SIGNAL", value: 9 })).toBe("信号 9");
    expect(exitText(undefined)).toBe("无记录");
  });

  it("distinguishes file-without-load, load-without-file and unmatched files", () => {
    const [, , fileOnly, , loadedOnly, unmatched] = sampleServices();
    expect(statusPresentation(fileOnly).label).toBe("未加载");
    expect(correlationText(fileOnly)).toContain("有配置文件，当前未加载");
    expect(correlationText(loadedOnly)).toContain("已加载，未在扫描位置找到配置文件");
    expect(correlationText(unmatched)).toContain("无法对应到任务");
    expect(correlationText(unmatched)).toContain("符号链接");
    // A load-only job with an unknown presence must not claim absence.
    expect(
      correlationText(
        launchdService({ correlation: "LOADED_ONLY", configPresence: "UNKNOWN", configFiles: [] }),
      ),
    ).toContain("无法确认");
  });

  it("gives list rows a short line only for non-matched entries", () => {
    const [running, , fileOnly, , loadedOnly, unmatched] = sampleServices();
    expect(correlationBrief(running)).toBeUndefined();
    expect(correlationBrief(fileOnly)).toBe("有配置文件，当前未加载");
    expect(correlationBrief(loadedOnly)).toBe("已加载，未找到配置文件");
    expect(correlationBrief(unmatched)).toBe("配置文件无法对应到任务");
    expect(
      correlationBrief(
        launchdService({ correlation: "LOADED_ONLY", configPresence: "UNKNOWN", configFiles: [] }),
      ),
    ).toContain("无法确认");
  });

  it("labels scope by directory without claiming ownership", () => {
    expect(scopeLabel("USER_AGENT")).toBe("用户代理");
    expect(scopeLabel("GLOBAL_AGENT")).toBe("全局代理");
    expect(scopeLabel("SYSTEM_DAEMON")).toBe("系统 daemon");
    expect(scopeLabel("APPLE_AGENT")).toContain("Apple");
    expect(scopeLabel("APPLE_DAEMON")).toContain("Apple");
    expect(scopeLabel("UNATTRIBUTED")).toContain("未找到配置文件");
    expect(domainLabel("GUI")).toBe("用户会话");
    expect(domainLabel("SYSTEM")).toBe("系统");
  });
});

describe("execution summary", () => {
  it("returns the executable and arguments from the first parsed file", () => {
    const [service] = sampleServices();
    expect(executionOf(service)).toEqual({
      executable: "/usr/local/bin/example",
      arguments: ["--serve", "--token=••••"],
      truncated: false,
    });
  });

  it("falls back to the first argument when Program is absent", () => {
    const service = launchdService({
      configFiles: [
        configFile({
          details: {
            programArguments: ["/bin/tool", "-x"],
            argumentsTruncated: true,
            environmentKeys: [],
          },
        }),
      ],
    });
    expect(executionOf(service)).toEqual({
      executable: "/bin/tool",
      arguments: ["-x"],
      truncated: true,
    });
  });

  it("is undefined when no file could be parsed", () => {
    const [, , , , loadedOnly, unmatched] = sampleServices();
    expect(executionOf(loadedOnly)).toBeUndefined();
    expect(executionOf(unmatched)).toBeUndefined();
  });
});

describe("search and filters", () => {
  it("returns everything for the empty filter", () => {
    expect(ids({})).toHaveLength(6);
  });

  it("searches label, short name and paths case-insensitively", () => {
    expect(ids({ query: "EXAMPLE.IDLE" })).toEqual(["com.example.idle"]);
    expect(ids({ query: "vendor" })).toEqual(["com.vendor.daemon"]);
    expect(ids({ query: "/Library/LaunchDaemons" })).toEqual([
      "com.vendor.daemon",
    ]);
    expect(ids({ query: "  mds " })).toEqual(["com.apple.metadata.mds"]);
    expect(ids({ query: "/usr/local/bin/example" })).toContain(
      "com.example.agent",
    );
    expect(ids({ query: "no-such-thing" })).toEqual([]);
  });

  it("does not search environment keys", () => {
    expect(ids({ query: "API_TOKEN" })).toEqual([]);
  });

  it("filters by source scope, domain and status together", () => {
    expect(ids({ scope: "SYSTEM_DAEMON" })).toEqual(["com.vendor.daemon"]);
    expect(ids({ scope: "APPLE_DAEMON" })).toEqual(["com.apple.metadata.mds"]);
    expect(ids({ domain: "SYSTEM" })).toEqual([
      "com.vendor.daemon",
      "com.apple.metadata.mds",
    ]);
    expect(ids({ status: "NOT_LOADED" })).toEqual(["com.example.disabled"]);
    expect(ids({ status: "RUNNING", domain: "GUI" })).toEqual([
      "com.example.agent",
    ]);
    expect(ids({ status: "UNKNOWN", query: "broken" })).toEqual(["broken"]);
    expect(ids({ status: "RUNNING", scope: "USER_AGENT", domain: "SYSTEM" })).toEqual([]);
  });

  it("keeps the original order", () => {
    expect(ids({ status: "RUNNING" })).toEqual([
      "com.example.agent",
      "com.vendor.daemon",
      "com.apple.metadata.mds",
    ]);
  });
});

describe("stable selection", () => {
  const services = sampleServices();

  it("keeps the selection by domain + label id after a refresh", () => {
    const refreshed = [...services].reverse();
    const resolved = resolveSelection(refreshed, "gui/501/com.example.idle");
    expect(resolved.kind).toBe("found");
    if (resolved.kind === "found") {
      expect(resolved.service.label).toBe("com.example.idle");
    }
  });

  it("reports a vanished selection instead of switching silently", () => {
    expect(
      resolveSelection(services.slice(0, 2), "system/com.vendor.daemon"),
    ).toEqual({ kind: "gone", id: "system/com.vendor.daemon" });
  });

  it("does not confuse the same label in two domains", () => {
    const pair = [
      launchdService({ id: "gui/501/com.same", label: "com.same" }),
      launchdService({
        id: "system/com.same",
        label: "com.same",
        domain: "SYSTEM",
        domainTarget: "system",
      }),
    ];
    const resolved = resolveSelection(pair, "system/com.same");
    expect(resolved.kind === "found" && resolved.service.domain).toBe("SYSTEM");
  });

  it("has no selection when none is chosen", () => {
    expect(resolveSelection(services, undefined)).toEqual({ kind: "none" });
  });
});

describe("keyboard navigation", () => {
  it("moves within bounds with arrows, Home and End", () => {
    expect(moveIndex("ArrowDown", 0, 3)).toBe(1);
    expect(moveIndex("ArrowDown", 2, 3)).toBe(2);
    expect(moveIndex("ArrowUp", 0, 3)).toBe(0);
    expect(moveIndex("ArrowUp", 2, 3)).toBe(1);
    expect(moveIndex("Home", 2, 3)).toBe(0);
    expect(moveIndex("End", 0, 3)).toBe(2);
    expect(moveIndex("Enter", 1, 3)).toBeUndefined();
    expect(moveIndex("ArrowDown", 0, 0)).toBeUndefined();
  });
});

describe("partial results", () => {
  it("lists only sources that failed or lost files", () => {
    expect(problemSources(sampleDiscovery())).toEqual([]);
    const problems = problemSources(partialDiscovery());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      source: "LAUNCHCTL_PRINT_SYSTEM",
      reason: "权限不足，无法读取。",
    });
    expect(
      problemSources(
        sampleDiscovery({
          complete: false,
          sources: [sourceReport({ source: "USER_LAUNCH_AGENTS", status: "COMPLETE", failedFiles: 2 })],
        }),
      )[0].reason,
    ).toContain("2 个文件");
  });

  it("treats a missing directory as normal, not a failure", () => {
    expect(sourceReasonText("DIRECTORY_MISSING")).toContain("不存在");
    expect(
      problemSources(
        sampleDiscovery({
          sources: [sourceReport({ source: "GLOBAL_LAUNCH_AGENTS", reason: "DIRECTORY_MISSING" })],
        }),
      ),
    ).toEqual([]);
  });
});

describe("Homebrew evidence", () => {
  const summary = (serviceId: string): ServiceSummary => ({
    serviceId,
    displayName: serviceId,
    state: "STARTED",
    status: "started",
    scope: "USER",
    manageable: true,
  });

  it("matches only the Homebrew-named label and never invents evidence", () => {
    const brew = launchdService({
      id: "gui/501/homebrew.mxcl.caddy",
      label: "homebrew.mxcl.caddy",
    });
    const other = launchdService();
    expect(evidenceFor(brew, [summary("caddy")])?.serviceId).toBe("caddy");
    expect(evidenceFor(brew, [summary("unbound")])).toBeUndefined();
    expect(evidenceFor(other, [summary("caddy")])).toBeUndefined();
    expect(evidenceFor(brew, [])).toBeUndefined();
  });
});

describe("discovery state machine", () => {
  const discovery = sampleDiscovery();

  it("starts loading, then ready, then refreshes without dropping data", () => {
    let state = INITIAL_DISCOVERY_STATE;
    expect(state.status).toBe("loading");
    state = discoveryReducer(state, { type: "loaded", discovery });
    expect(state).toMatchObject({ status: "ready", refreshing: false });
    state = discoveryReducer(state, { type: "refreshStarted" });
    expect(state).toMatchObject({ status: "ready", refreshing: true });
    if (state.status === "ready") expect(state.discovery).toBe(discovery);
  });

  it("fails closed on the first load", () => {
    const state = discoveryReducer(INITIAL_DISCOVERY_STATE, {
      type: "failed",
      error: ERROR,
    });
    expect(state).toEqual({ status: "error", error: ERROR });
  });

  it("keeps the previous list visible when a refresh fails", () => {
    const ready = discoveryReducer(INITIAL_DISCOVERY_STATE, {
      type: "loaded",
      discovery,
    });
    const failed = discoveryReducer(
      discoveryReducer(ready, { type: "refreshStarted" }),
      { type: "failed", error: ERROR },
    );
    expect(failed).toMatchObject({
      status: "ready",
      refreshing: false,
      refreshError: ERROR,
    });
    if (failed.status === "ready") expect(failed.discovery).toBe(discovery);
    const recovered = discoveryReducer(failed, { type: "loaded", discovery });
    expect(recovered).toEqual({ status: "ready", discovery, refreshing: false });
  });

  it("retries from the error state", () => {
    const failed = discoveryReducer(INITIAL_DISCOVERY_STATE, {
      type: "failed",
      error: ERROR,
    });
    expect(discoveryReducer(failed, { type: "refreshStarted" })).toEqual({
      status: "loading",
    });
  });
});

describe("refresh throttle", () => {
  it("blocks while a refresh is in flight and inside the minimum interval", () => {
    const now = 100_000;
    expect(canStartRefresh({ inFlight: true, lastStartedAt: undefined, now })).toBe(false);
    expect(canStartRefresh({ inFlight: false, lastStartedAt: undefined, now })).toBe(true);
    expect(
      canStartRefresh({ inFlight: false, lastStartedAt: now - 100, now }),
    ).toBe(false);
    expect(
      canStartRefresh({
        inFlight: false,
        lastStartedAt: now - DISCOVERY_REFRESH_MIN_INTERVAL_MS,
        now,
      }),
    ).toBe(true);
  });
});

describe("ownership presentation", () => {
  it("names every ownership class distinctly and in Chinese", () => {
    const labels = LAUNCHD_OWNERSHIPS.map(ownershipLabel);
    expect(new Set(labels).size).toBe(LAUNCHD_OWNERSHIPS.length);
    for (const label of labels) expect(label).toMatch(/[\u4e00-\u9fff]/);
    expect(ownershipLabel("APPLE_MANAGED")).toContain("Apple");
    expect(ownershipLabel("USERHOME_CREATED")).toContain("UserHome");
    for (const kind of LAUNCHD_OWNERSHIPS) {
      expect(ownershipDescription(kind).length).toBeGreaterThan(8);
    }
  });

  it("explains every read-only reason and every piece of evidence", () => {
    for (const reason of LAUNCHD_READ_ONLY_REASONS) {
      const text = readOnlyReasonText(reason);
      expect(text, reason).toMatch(/[\u4e00-\u9fff]/);
      expect(text, reason).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
    for (const evidence of LAUNCHD_EVIDENCE) {
      const text = evidenceText(evidence);
      expect(text, evidence).toMatch(/[\u4e00-\u9fff]/);
      expect(text, evidence).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  it("summarizes read-only and modifiable verdicts without promising an action", () => {
    const readOnly = ownershipSummary(launchdService());
    expect(readOnly.modifiable).toBe(false);
    expect(readOnly.badge).toBe("只读");
    expect(readOnly.reasons.length).toBeGreaterThan(0);
    expect(readOnly.reasons.join("")).toContain("接管");

    const created = ownershipSummary(createdService());
    expect(created.modifiable).toBe(true);
    expect(created.badge).toBe("可修改");
    expect(created.reasons).toEqual([]);
    expect(created.note).toContain("没有修改入口");
  });

  it("filters by ownership, separately from the directory-based source", () => {
    expect(ids({ ownership: "APPLE_MANAGED" })).toEqual([
      "com.apple.metadata.mds",
    ]);
    expect(ids({ ownership: "SYSTEM_DAEMON" })).toEqual(["com.vendor.daemon"]);
    expect(ids({ ownership: "THIRD_PARTY" })).toEqual(["broken"]);
    expect(ids({ ownership: "CURRENT_USER_AGENT" })).toEqual([
      "com.example.agent",
      "com.example.idle",
      "com.example.disabled",
    ]);
    expect(ids({ ownership: "USERHOME_CREATED" })).toEqual([]);
    // Source (by directory) and ownership (judged) are independent filters.
    expect(ids({ scope: "USER_AGENT", ownership: "THIRD_PARTY" })).toEqual([
      "broken",
    ]);
    expect(ids({ scope: "SYSTEM_DAEMON", ownership: "THIRD_PARTY" })).toEqual(
      [],
    );
    expect(ids({ ownership: "ALL" })).toHaveLength(6);
  });

  it("counts an ownership filter as an active filter and clears with the empty filter", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, ownership: "APPLE_MANAGED" })).toBe(
      true,
    );
    expect(EMPTY_FILTER.ownership).toBe("ALL");
  });

  it("keeps the fixtures' verdicts self-consistent", () => {
    for (const verdict of [
      APPLE_OWNERSHIP,
      DAEMON_OWNERSHIP,
      THIRD_PARTY_OWNERSHIP,
      CREATED_OWNERSHIP,
    ]) {
      expect(verdict.modifiable).toBe(verdict.readOnlyReasons.length === 0);
    }
  });
});
