import { describe, expect, it } from "vitest";
import type { CaddyConflictReport, CaddyStartSummary } from "../../ipc/caddy";
import {
  externalServiceTargets,
  presentVerdict,
  serviceFocusIntent,
  startGate,
} from "./caddyConflictModel";

const BASE: CaddyConflictReport = {
  verdict: "CLEAR",
  headline: "未发现冲突，不保证绑定成功。",
  blocks: [],
  external: { snapshot: "COMPLETE", explanation: "快照完整。", instances: [] },
  ports: [],
  upstreams: [],
  notes: [],
};

const RUNNING_EXTERNAL: CaddyConflictReport = {
  ...BASE,
  verdict: "BLOCKED",
  headline: "发现冲突，已拒绝开启。",
  blocks: ["EXTERNAL_RUNNING"],
  external: {
    snapshot: "COMPLETE",
    explanation: "快照完整。",
    instances: [
      {
        label: "homebrew.mxcl.caddy",
        domain: "GUI",
        runState: "RUNNING",
        pid: 77,
        explanation: "外部常驻 Caddy 正在运行。",
      },
      {
        label: "homebrew.mxcl.stopped",
        domain: "SYSTEM",
        runState: "NOT_RUNNING",
        explanation: "未运行。",
      },
    ],
  },
};

function summary(overrides: Partial<CaddyStartSummary> = {}): CaddyStartSummary {
  return {
    planId: "plan-1",
    source: "RULES",
    executablePath: "/opt/homebrew/bin/caddy",
    version: "v2.8.4",
    workingDirectory: "<私有运行目录>",
    configFingerprint: "0123456789abcdef",
    listen: ["http://127.0.0.1:8080"],
    upstreams: [],
    adminEndpoint: "私有 socket",
    notes: [],
    conflicts: BASE,
    ...overrides,
  };
}

describe("presentVerdict", () => {
  it("pairs every verdict with a symbol and a text label, never colour alone", () => {
    expect(presentVerdict("CLEAR")).toMatchObject({ symbol: "✓", label: "未发现冲突" });
    expect(presentVerdict("UNCONFIRMED")).toMatchObject({ symbol: "!", label: "需要确认" });
    expect(presentVerdict("BLOCKED")).toMatchObject({ symbol: "✕", label: "发现冲突" });
  });
});

describe("startGate", () => {
  it("allows a clear summary to start without any acceptance flag", () => {
    expect(startGate(summary(), false)).toEqual({ canStart: true, acceptUnconfirmed: false });
  });

  it("never allows a blocked summary or a summary without a plan to start", () => {
    expect(startGate(summary({ conflicts: RUNNING_EXTERNAL }), true)).toEqual({
      canStart: false,
      acceptUnconfirmed: false,
    });
    expect(startGate(summary({ planId: undefined, blocked: "未找到可用的 Caddy 可执行文件。", executablePath: undefined, version: undefined }), true)).toEqual({
      canStart: false,
      acceptUnconfirmed: false,
    });
  });

  it("starts an unconfirmed summary only after the explicit acceptance", () => {
    const unconfirmed = summary({
      conflicts: { ...BASE, verdict: "UNCONFIRMED", headline: "有项目无法确认，开启需你显式确认。" },
    });
    expect(startGate(unconfirmed, false)).toEqual({ canStart: false, acceptUnconfirmed: false });
    expect(startGate(unconfirmed, true)).toEqual({ canStart: true, acceptUnconfirmed: true });
  });
});

describe("externalServiceTargets", () => {
  it("offers the running external instances only when an external block applies", () => {
    expect(externalServiceTargets(RUNNING_EXTERNAL)).toEqual([
      { label: "homebrew.mxcl.caddy", domain: "GUI" },
    ]);
  });

  it("offers no jump for a port conflict alone or for a stopped instance", () => {
    expect(
      externalServiceTargets({ ...RUNNING_EXTERNAL, blocks: ["PORT_OCCUPIED"] }),
    ).toEqual([]);
    expect(
      externalServiceTargets({
        ...RUNNING_EXTERNAL,
        external: {
          ...RUNNING_EXTERNAL.external,
          instances: [RUNNING_EXTERNAL.external.instances[1]],
        },
      }),
    ).toEqual([]);
  });
});

describe("serviceFocusIntent", () => {
  it("names the external task for the services page and carries no other field", () => {
    expect(serviceFocusIntent({ label: "homebrew.mxcl.caddy", domain: "GUI" })).toEqual({
      routeId: "services",
      serviceFocus: { label: "homebrew.mxcl.caddy", domain: "GUI" },
      source: "content",
    });
  });
});
