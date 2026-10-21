import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  caddyDetect,
  caddyLoadRules,
  caddyPreview,
  caddySave,
  caddyStart,
  decodeDetectReport,
  decodeLoadedRules,
  decodePreview,
  decodeStartSummary,
  toRulesRequest,
  type CaddyRules,
} from "./caddy";

afterEach(() => {
  clearMocks();
});

const SAFE_RULES: CaddyRules = {
  version: 1,
  sites: [
    {
      enabled: true,
      listen: { host: "127.0.0.1", port: 8080 },
      upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
    },
  ],
};

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

function validationWire(overrides: Record<string, unknown> = {}) {
  return {
    issues: [],
    conflicts: [],
    exposures: [
      {
        site: 0,
        listen: "127.0.0.1:8080",
        visibleExternally: false,
        reason: "LOOPBACK",
      },
    ],
    ...overrides,
  };
}

function previewWire(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    validation: validationWire(),
    generatedText: "http://127.0.0.1:8080 {\n\treverse_proxy http://127.0.0.1:3000\n}\n",
    diff: [{ change: "ADDED", text: "http://127.0.0.1:8080 {" }],
    hasSavedVersion: false,
    ...overrides,
  };
}

function blockedPreviewWire(overrides: Record<string, unknown> = {}) {
  return previewWire({
    valid: false,
    generatedText: undefined,
    diff: undefined,
    ...overrides,
  });
}

function detectWire(overrides: Record<string, unknown> = {}) {
  return {
    status: "AVAILABLE",
    executablePath: "/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy",
    version: "v2.8.4 h1:fixture",
    candidates: [
      { source: "FIXED", displayPath: "/opt/homebrew/bin/caddy", outcome: "USABLE" },
    ],
    ...overrides,
  };
}

describe("caddy_load_rules decoding", () => {
  it("decodes saved and default rules with their source", () => {
    expect(
      decodeLoadedRules({ rules: SAFE_RULES, source: "SAVED" }),
    ).toEqual({ rules: SAFE_RULES, source: "SAVED" });
    expect(decodeLoadedRules({ rules: SAFE_RULES, source: "DEFAULT" }).source).toBe(
      "DEFAULT",
    );
  });

  it("fails closed on an unknown source, a missing sites list or a stray field", () => {
    expectInternal(() =>
      decodeLoadedRules({ rules: SAFE_RULES, source: "UNKNOWN" }),
    );
    expectInternal(() =>
      decodeLoadedRules({ rules: { version: 1 }, source: "SAVED" }),
    );
    expectInternal(() =>
      decodeLoadedRules({
        rules: { ...SAFE_RULES, caddyfile: "http://evil {}" },
        source: "SAVED",
      }),
    );
  });

  it("fails closed on a site whose upstream scheme is not http or https", () => {
    const wire = {
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [{ scheme: "ftp", host: "127.0.0.1", port: 3000 }],
          },
        ],
      },
      source: "SAVED",
    };
    expectInternal(() => decodeLoadedRules(wire));
  });

  it("fails closed on a non-integer or out-of-range port", () => {
    for (const port of [0, 65536, 80.5, "8080", -1]) {
      const wire = {
        rules: {
          version: 1,
          sites: [
            {
              enabled: true,
              listen: { host: "127.0.0.1", port },
              upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
            },
          ],
        },
        source: "SAVED",
      };
      expectInternal(() => decodeLoadedRules(wire));
    }
  });

  it("rejects non-object payloads", () => {
    expectInternal(() => decodeLoadedRules(null));
    expectInternal(() => decodeLoadedRules("rules"));
    expectInternal(() => decodeLoadedRules([]));
  });
});

describe("caddy_preview decoding", () => {
  it("decodes a valid preview with text and a diff", () => {
    expect(decodePreview(previewWire())).toMatchObject({
      valid: true,
      generatedText: expect.stringContaining("reverse_proxy"),
      diff: [{ change: "ADDED", text: "http://127.0.0.1:8080 {" }],
      hasSavedVersion: false,
    });
  });

  it("decodes a blocked preview that carries no text or diff", () => {
    const decoded = decodePreview({
      valid: false,
      validation: validationWire({
        issues: [
          {
            code: "FORBIDDEN_CHARACTER",
            severity: "ERROR",
            site: 0,
            field: "listen.host",
            message: "主机包含不允许的字符。",
          },
        ],
        exposures: [],
      }),
      hasSavedVersion: true,
    });

    expect(decoded.valid).toBe(false);
    expect(decoded.generatedText).toBeUndefined();
    expect(decoded.diff).toBeUndefined();
    expect(decoded.validation.issues[0]).toMatchObject({
      code: "FORBIDDEN_CHARACTER",
      severity: "ERROR",
      site: 0,
      field: "listen.host",
    });
  });

  it("fails closed when the valid flag disagrees with the validation report", () => {
    expectInternal(() =>
      decodePreview(
        previewWire({
          valid: true,
          validation: validationWire({
            issues: [
              {
                code: "INVALID_PORT",
                severity: "ERROR",
                site: 0,
                field: "listen.port",
                message: "端口必须在 1 到 65535 之间。",
              },
            ],
          }),
        }),
      ),
    );
    expectInternal(() =>
      decodePreview(
        blockedPreviewWire({
          validation: validationWire(),
        }),
      ),
    );
  });

  it("fails closed when a valid preview is missing its text or diff", () => {
    expectInternal(() => decodePreview(previewWire({ generatedText: undefined })));
    expectInternal(() => decodePreview(previewWire({ diff: undefined })));
  });

  it("fails closed on an unknown issue code, field name or diff marker", () => {
    expectInternal(() =>
      decodePreview(
        blockedPreviewWire({
          validation: validationWire({
            issues: [
              {
                code: "MADE_UP",
                severity: "ERROR",
                message: "x",
              },
            ],
          }),
        }),
      ),
    );
    expectInternal(() =>
      decodePreview(
        blockedPreviewWire({
          validation: validationWire({
            issues: [
              {
                code: "INVALID_HOST",
                severity: "ERROR",
                site: 0,
                field: "caddyfile",
                message: "x",
              },
            ],
          }),
        }),
      ),
    );
    expectInternal(() =>
      decodePreview(previewWire({ diff: [{ change: "MODIFIED", text: "x" }] })),
    );
  });

  it("fails closed on an unknown exposure reason", () => {
    expectInternal(() =>
      decodePreview(
        previewWire({
          validation: validationWire({
            exposures: [
              {
                site: 0,
                listen: "127.0.0.1:8080",
                visibleExternally: false,
                reason: "PUBLIC",
              },
            ],
          }),
        }),
      ),
    );
  });

  it("decodes conflicts as listen address plus site indexes", () => {
    const decoded = decodePreview(
      blockedPreviewWire({
        validation: validationWire({
          conflicts: [{ listen: "127.0.0.1:8080", sites: [0, 1] }],
          exposures: [],
        }),
      }),
    );

    expect(decoded.validation.conflicts).toEqual([
      { listen: "127.0.0.1:8080", sites: [0, 1] },
    ]);
  });
});

describe("caddy_detect decoding", () => {
  it("decodes an available executable with its version", () => {
    expect(decodeDetectReport(detectWire())).toMatchObject({
      status: "AVAILABLE",
      version: "v2.8.4 h1:fixture",
      candidates: [{ source: "FIXED", outcome: "USABLE" }],
    });
  });

  it("decodes a missing report and keeps the backend guidance text", () => {
    const decoded = decodeDetectReport({
      status: "MISSING",
      guidance: "未找到 Caddy。请先通过 Homebrew 手动安装（brew install caddy）。",
      candidates: [{ source: "FIXED", displayPath: "/usr/local/bin/caddy", outcome: "MISSING" }],
    });

    expect(decoded.status).toBe("MISSING");
    expect(decoded.guidance).toContain("brew install caddy");
    expect(decoded.executablePath).toBeUndefined();
    expect(decoded.version).toBeUndefined();
  });

  it("fails closed when an available report has no version or carries guidance", () => {
    expectInternal(() => decodeDetectReport(detectWire({ version: undefined })));
    expectInternal(() =>
      decodeDetectReport(detectWire({ guidance: "should not be here" })),
    );
  });

  it("fails closed on an unknown status or candidate outcome", () => {
    expectInternal(() => decodeDetectReport(detectWire({ status: "RUNNING" })));
    expectInternal(() =>
      decodeDetectReport(
        detectWire({
          candidates: [{ source: "FIXED", displayPath: "/x", outcome: "EXECUTED" }],
        }),
      ),
    );
  });
});

describe("toRulesRequest", () => {
  it("sends only the structured rule fields", () => {
    const request = toRulesRequest(SAFE_RULES);

    expect(request).toEqual(SAFE_RULES);
    expect(JSON.stringify(request)).not.toMatch(/caddyfile|path|Caddyfile|reverse_proxy/);
  });

  it("drops any extra property a caller might attach", () => {
    const polluted = {
      ...SAFE_RULES,
      path: "/etc/Caddyfile",
      caddyfile: "http://evil {}",
      sites: [
        {
          ...SAFE_RULES.sites[0],
          directives: ["admin 0.0.0.0:2019"],
          listen: { host: "127.0.0.1", port: 8080, tls: true },
        },
      ],
    } as unknown as CaddyRules;

    const serialized = JSON.stringify(toRulesRequest(polluted));

    expect(serialized).not.toContain("evil");
    expect(serialized).not.toContain("/etc/Caddyfile");
    expect(serialized).not.toContain("directives");
    expect(serialized).not.toContain("tls");
  });
});

describe("caddy command requests", () => {
  it("loads rules without sending any arguments", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_load_rules");
      expect(payload).toEqual({});
      return { rules: SAFE_RULES, source: "SAVED" };
    });

    await expect(caddyLoadRules()).resolves.toEqual({
      rules: SAFE_RULES,
      source: "SAVED",
    });
  });

  it("sends only structured rules when previewing", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_preview");
      expect(payload).toEqual({ input: SAFE_RULES });
      expect(JSON.stringify(payload)).not.toMatch(/caddyfile|path/i);
      return previewWire();
    });

    await expect(caddyPreview(SAFE_RULES)).resolves.toMatchObject({ valid: true });
  });

  it("sends only structured rules when saving and expects no payload back", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_save");
      expect(payload).toEqual({ input: SAFE_RULES });
      return null;
    });

    await expect(caddySave(SAFE_RULES)).resolves.toBeUndefined();
  });

  it("fails closed when save returns a payload", async () => {
    mockIPC(() => ({ saved: true }));

    await expect(caddySave(SAFE_RULES)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("surfaces PARTIAL_FAILURE from save as its own error code", async () => {
    mockIPC(() => {
      throw {
        code: "PARTIAL_FAILURE",
        message: "规则已保存，但 Caddyfile 未能更新。",
        retryable: false,
      };
    });

    await expect(caddySave(SAFE_RULES)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      retryable: false,
    });
  });

  it("sends an empty detect input unless a grant id is given", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_detect");
      expect(payload).toEqual({ input: {} });
      return detectWire();
    });

    await expect(caddyDetect()).resolves.toMatchObject({ status: "AVAILABLE" });
  });

  it("sends only the grant id when a grant is given to detect", async () => {
    const grantId = "5f3b6e6e-0000-4000-8000-000000000001";
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_detect");
      expect(payload).toEqual({ input: { executableGrantId: grantId } });
      return detectWire();
    });

    await caddyDetect(grantId);
  });

  it("turns an invalid payload from the backend into an internal error", async () => {
    mockIPC(() => ({ rules: "not rules", source: "SAVED" }));

    await expect(caddyLoadRules()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

const CONFLICT_BLOCKED = {
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
        explanation: "外部常驻 Caddy 正在运行。",
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
    {
      host: "127.0.0.1",
      port: 8081,
      state: "OCCUPIED",
      occupant: null,
      explanation: "端口已被占用，占用方未知。",
    },
  ],
  upstreams: [
    {
      host: "127.0.0.1",
      port: 3000,
      state: "UNREACHABLE",
      explanation: "上游不可达。这只是提示。",
    },
  ],
  notes: [],
};

const START_SUMMARY_WITH_CONFLICTS = {
  planId: "7f0c9a2e-1b3d-4c5e-8f60-123456789abc",
  source: "RULES",
  executablePath: "/opt/homebrew/bin/caddy",
  version: "v2.8.4",
  workingDirectory: "<私有运行目录>",
  configFingerprint: "0123456789abcdef",
  listen: ["http://127.0.0.1:8080"],
  upstreams: ["http://127.0.0.1:3000"],
  adminEndpoint: "仅本次运行的私有 Unix socket（不占用默认 localhost:2019）",
  notes: [],
  conflicts: CONFLICT_BLOCKED,
};

describe("caddy_prepare_start conflict decoding", () => {
  it("decodes the conflict report with its external owner, ports and upstreams", () => {
    const summary = decodeStartSummary(START_SUMMARY_WITH_CONFLICTS);
    expect(summary.conflicts?.verdict).toBe("BLOCKED");
    expect(summary.conflicts?.blocks).toEqual(["EXTERNAL_RUNNING", "PORT_OCCUPIED"]);
    expect(summary.conflicts?.external.instances[0]).toMatchObject({
      label: "homebrew.mxcl.caddy",
      domain: "GUI",
      runState: "RUNNING",
      pid: 77,
    });
    expect(summary.conflicts?.ports[0].occupant).toEqual({ name: "caddy", pid: 77 });
    expect(summary.conflicts?.ports[1].occupant).toBeUndefined();
    expect(summary.conflicts?.upstreams[0].state).toBe("UNREACHABLE");
  });

  it("accepts a summary without a conflict report, which a non-start summary may omit", () => {
    const withoutConflicts: Record<string, unknown> = { ...START_SUMMARY_WITH_CONFLICTS };
    delete withoutConflicts.conflicts;
    expect(decodeStartSummary(withoutConflicts).conflicts).toBeUndefined();
  });

  it("fails closed on an unknown verdict, block reason or port state", () => {
    expect(() =>
      decodeStartSummary({
        ...START_SUMMARY_WITH_CONFLICTS,
        conflicts: { ...CONFLICT_BLOCKED, verdict: "AVAILABLE" },
      }),
    ).toThrow();
    expect(() =>
      decodeStartSummary({
        ...START_SUMMARY_WITH_CONFLICTS,
        conflicts: { ...CONFLICT_BLOCKED, blocks: ["UNKNOWN_REASON"] },
      }),
    ).toThrow();
    expect(() =>
      decodeStartSummary({
        ...START_SUMMARY_WITH_CONFLICTS,
        conflicts: {
          ...CONFLICT_BLOCKED,
          ports: [{ ...CONFLICT_BLOCKED.ports[0], state: "AVAILABLE" }],
        },
      }),
    ).toThrow();
  });

  it("fails closed on a stray field inside the conflict report", () => {
    expect(() =>
      decodeStartSummary({
        ...START_SUMMARY_WITH_CONFLICTS,
        conflicts: { ...CONFLICT_BLOCKED, extra: true },
      }),
    ).toThrow();
  });

  it("fails closed on a pid that is not a safe non-negative integer", () => {
    expect(() =>
      decodeStartSummary({
        ...START_SUMMARY_WITH_CONFLICTS,
        conflicts: {
          ...CONFLICT_BLOCKED,
          ports: [{ ...CONFLICT_BLOCKED.ports[0], occupant: { name: "caddy", pid: -1 } }],
        },
      }),
    ).toThrow();
  });
});

describe("caddy_start acceptance flag", () => {
  it("sends the acceptance of an unconfirmed state only when given, leaving the default wire unchanged", async () => {
    const sent: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === "caddy_start") {
        sent.push(payload);
        return { state: "STARTING", message: "正在开启，等待管理端点就绪……", diagnostics: [] };
      }
      return undefined;
    });
    await caddyStart("plan-1", "RULES", { acceptUnconfirmed: true });
    await caddyStart("plan-1", "RULES");
    expect(sent).toEqual([
      { input: { planId: "plan-1", source: "RULES", confirmed: true, acceptUnconfirmed: true } },
      { input: { planId: "plan-1", source: "RULES", confirmed: true } },
    ]);
  });
});
