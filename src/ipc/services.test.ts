import { describe, expect, it } from "vitest";
import {
  decodeLaunchdConfigFile,
  decodeLaunchdDiscovery,
  decodeLaunchdService,
  decodeLaunchdSourceReport,
} from "./services";

function configFile(overrides: Record<string, unknown> = {}) {
  return {
    path: "~/Library/LaunchAgents/com.example.agent.plist",
    directory: "USER_LAUNCH_AGENTS",
    scope: "USER_AGENT",
    isApplePath: false,
    ownerUid: 501,
    kind: "REGULAR",
    linkTarget: null,
    parseStatus: "PARSED",
    details: {
      program: null,
      programArguments: ["/bin/svc", "--token", "[REDACTED]"],
      argumentsTruncated: false,
      environmentKeys: ["PATH"],
      runAtLoad: true,
      keepAlive: { mode: "CONDITIONAL", conditions: ["SuccessfulExit=false"] },
      standardOutPath: "~/Library/Logs/agent.log",
      standardErrorPath: null,
      disabled: null,
      userName: null,
    },
    ...overrides,
  };
}

function ownership(overrides: Record<string, unknown> = {}) {
  return {
    ownership: "CURRENT_USER_AGENT",
    modifiable: false,
    readOnlyReasons: ["NOT_ADOPTED"],
    evidence: ["DOMAIN_GUI", "IN_USER_LAUNCH_AGENTS", "OWNER_CURRENT_USER"],
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: "gui/501/com.example.agent",
    label: "com.example.agent",
    labelSource: "PLIST",
    domain: "GUI",
    domainTarget: "gui/501",
    scope: "USER_AGENT",
    correlation: "MATCHED",
    loadState: "LOADED",
    runState: "RUNNING",
    pid: 412,
    lastExit: { kind: "SIGNAL", value: 15 },
    configPresence: "FOUND",
    configFiles: [configFile()],
    issues: ["LABEL_FILENAME_MISMATCH"],
    ownership: ownership(),
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    source: "LAUNCHCTL_LIST",
    status: "COMPLETE",
    reason: null,
    items: 12,
    failedFiles: 0,
    ...overrides,
  };
}

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    services: [service()],
    sources: [source(), source({ source: "USER_LAUNCH_AGENTS" })],
    complete: true,
    truncated: false,
    ...overrides,
  };
}

describe("launchd discovery decoding", () => {
  it("decodes a full payload and drops null optionals", () => {
    const decoded = decodeLaunchdDiscovery(discovery());

    expect(decoded.complete).toBe(true);
    const [first] = decoded.services;
    expect(first).toMatchObject({
      id: "gui/501/com.example.agent",
      loadState: "LOADED",
      runState: "RUNNING",
      pid: 412,
      lastExit: { kind: "SIGNAL", value: 15 },
    });
    expect(first.configFiles[0].details).toEqual({
      programArguments: ["/bin/svc", "--token", "[REDACTED]"],
      argumentsTruncated: false,
      environmentKeys: ["PATH"],
      runAtLoad: true,
      keepAlive: { mode: "CONDITIONAL", conditions: ["SuccessfulExit=false"] },
      standardOutPath: "~/Library/Logs/agent.log",
    });
    expect("linkTarget" in first.configFiles[0]).toBe(false);
    expect("reason" in decoded.sources[0]).toBe(false);
  });

  it("decodes a loaded-only service and an unmatched link", () => {
    const loadedOnly = decodeLaunchdService(
      service({
        correlation: "LOADED_ONLY",
        labelSource: "LAUNCHCTL",
        scope: "UNATTRIBUTED",
        configPresence: "NOT_FOUND_IN_SCANNED",
        configFiles: [],
        issues: [],
        pid: null,
        runState: "NOT_RUNNING",
        lastExit: { kind: "CODE", value: 78 },
      }),
    );
    expect(loadedOnly.pid).toBeUndefined();
    expect(loadedOnly.lastExit).toEqual({ kind: "CODE", value: 78 });

    const link = decodeLaunchdConfigFile(
      configFile({
        kind: "LINK",
        parseStatus: "LINK_NOT_READ",
        details: null,
        linkTarget: { state: "OUTSIDE", display: "/opt/homebrew/x.plist" },
      }),
    );
    expect(link.linkTarget).toEqual({
      state: "OUTSIDE",
      display: "/opt/homebrew/x.plist",
    });
    expect(link.details).toBeUndefined();
  });

  it("keeps a source reason for partial results", () => {
    const report = decodeLaunchdSourceReport(
      source({
        source: "LAUNCHCTL_PRINT_SYSTEM",
        status: "INACCESSIBLE",
        reason: "PERMISSION_DENIED",
      }),
    );
    expect(report).toMatchObject({
      status: "INACCESSIBLE",
      reason: "PERMISSION_DENIED",
    });
    const partial = decodeLaunchdDiscovery(
      discovery({
        complete: false,
        sources: [report],
      }),
    );
    expect(partial.complete).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "services"],
    ["an array", []],
    ["missing services", { ...discovery(), services: undefined }],
    ["services not an array", discovery({ services: {} })],
    ["missing sources", { ...discovery(), sources: undefined }],
    ["complete not a boolean", discovery({ complete: "true" })],
    ["truncated missing", { ...discovery(), truncated: undefined }],
    [
      "too many services",
      discovery({ services: Array.from({ length: 4097 }, () => service()) }),
    ],
    [
      "too many sources",
      discovery({ sources: Array.from({ length: 17 }, () => source()) }),
    ],
  ])("rejects a malformed discovery: %s", (_name, payload) => {
    expect(() => decodeLaunchdDiscovery(payload)).toThrow();
  });

  it("rejects a result that claims completeness it does not have", () => {
    expect(() =>
      decodeLaunchdDiscovery(
        discovery({ sources: [source({ status: "FAILED", reason: "TIMEOUT" })] }),
      ),
    ).toThrow();
    expect(() =>
      decodeLaunchdDiscovery(discovery({ truncated: true })),
    ).toThrow();
  });

  it.each([
    ["an unknown load state", { loadState: "MAYBE" }],
    ["a lowercase run state", { runState: "running" }],
    ["an unknown domain", { domain: "USER" }],
    ["an unknown correlation", { correlation: "GUESSED" }],
    ["an unknown scope", { scope: "THIRD_PARTY" }],
    ["an unknown presence", { configPresence: "ABSENT" }],
    ["an unknown label source", { labelSource: "GUESS" }],
    ["an unknown issue", { issues: ["MODIFIABLE"] }],
    ["too many issues", { issues: Array(9).fill("DUPLICATE_LABEL") }],
    ["an empty id", { id: "" }],
    ["a missing label", { label: undefined }],
    ["an oversized label", { label: "a".repeat(3000) }],
    ["a negative pid", { pid: -1 }],
    ["a fractional pid", { pid: 1.5 }],
    ["a string pid", { pid: "412" }],
    ["a pid on a job that is not running", { runState: "NOT_RUNNING" }],
    ["a pid on a job that is not loaded", { loadState: "NOT_LOADED" }],
    ["an unknown exit kind", { lastExit: { kind: "CRASH", value: 1 } }],
    ["a non-integer exit value", { lastExit: { kind: "CODE", value: "1" } }],
    ["a non-object exit", { lastExit: 3 }],
    ["files not an array", { configFiles: "x" }],
    ["too many files", { configFiles: Array.from({ length: 65 }, () => configFile()) }],
  ])("rejects a service with %s", (_name, overrides) => {
    expect(() => decodeLaunchdService(service(overrides))).toThrow();
  });

  it.each([
    ["an unknown directory", { directory: "TMP" }],
    ["an unknown parse status", { parseStatus: "OK" }],
    ["an unknown kind", { kind: "DIRECTORY" }],
    ["a non-boolean apple flag", { isApplePath: 1 }],
    ["a negative owner", { ownerUid: -5 }],
    ["an empty path", { path: "" }],
    ["a non-string path", { path: 4 }],
    ["an unknown link state", { linkTarget: { state: "FOLLOWED" } }],
    ["a non-object link target", { linkTarget: "x" }],
    ["details that are not an object", { details: [] }],
    ["arguments that are not text", { details: { ...configFile().details, programArguments: [1] } }],
    ["too many arguments", { details: { ...configFile().details, programArguments: Array(257).fill("a") } }],
    ["environment keys that are not an array", { details: { ...configFile().details, environmentKeys: "PATH" } }],
    ["a missing truncation flag", { details: { ...configFile().details, argumentsTruncated: undefined } }],
    ["an unknown keep-alive mode", { details: { ...configFile().details, keepAlive: { mode: "SOMETIMES", conditions: [] } } }],
    ["a non-boolean run-at-load", { details: { ...configFile().details, runAtLoad: "yes" } }],
    ["oversized text", { details: { ...configFile().details, program: "x".repeat(3000) } }],
  ])("rejects a config file with %s", (_name, overrides) => {
    expect(() => decodeLaunchdConfigFile(configFile(overrides))).toThrow();
  });

  it.each([
    ["an unknown source", { source: "LAUNCHCTL_KILL" }],
    ["an unknown status", { status: "OK" }],
    ["an unknown reason", { reason: "BAD_LUCK" }],
    ["a negative count", { items: -1 }],
    ["a fractional count", { failedFiles: 0.5 }],
    ["a missing count", { items: undefined }],
  ])("rejects a source report with %s", (_name, overrides) => {
    expect(() => decodeLaunchdSourceReport(source(overrides))).toThrow();
  });
});

const CREATED_LABEL = "com.zephyr194.userhome.agent.demo";

function createdService(overrides: Record<string, unknown> = {}) {
  return service({
    id: `gui/501/${CREATED_LABEL}`,
    label: CREATED_LABEL,
    issues: [],
    ownership: ownership({
      ownership: "USERHOME_CREATED",
      modifiable: true,
      readOnlyReasons: [],
      evidence: ["LABEL_USERHOME_NAMESPACE", "IN_USER_LAUNCH_AGENTS"],
    }),
    ...overrides,
  });
}

describe("launchd ownership decoding", () => {
  it("decodes the backend verdict, its reasons and its evidence", () => {
    const decoded = decodeLaunchdService(service());
    expect(decoded.ownership).toEqual({
      kind: "CURRENT_USER_AGENT",
      modifiable: false,
      readOnlyReasons: ["NOT_ADOPTED"],
      evidence: ["DOMAIN_GUI", "IN_USER_LAUNCH_AGENTS", "OWNER_CURRENT_USER"],
    });
    const created = decodeLaunchdService(createdService());
    expect(created.ownership).toMatchObject({
      kind: "USERHOME_CREATED",
      modifiable: true,
      readOnlyReasons: [],
    });
    const discovery = decodeLaunchdDiscovery(
      discoveryWith([service(), createdService()]),
    );
    expect(discovery.services.map((item) => item.ownership.modifiable)).toEqual(
      [false, true],
    );
  });

  it.each([
    "CURRENT_USER_AGENT",
    "GLOBAL_AGENT",
    "SYSTEM_DAEMON",
    "APPLE_MANAGED",
    "THIRD_PARTY",
    "USERHOME_CREATED",
    "USERHOME_ADOPTED",
  ])("accepts the ownership class %s when it is consistent", (kind) => {
    const modifiable = kind.startsWith("USERHOME_");
    const verdict = ownership({
      ownership: kind,
      modifiable,
      readOnlyReasons: modifiable ? [] : ["NOT_ADOPTED"],
    });
    expect(() =>
      decodeLaunchdService(
        kind === "USERHOME_CREATED"
          ? createdService({ ownership: verdict })
          : service({ ownership: verdict }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["a missing verdict", { ownership: undefined }],
    ["a null verdict", { ownership: null }],
    ["a string verdict", { ownership: "USERHOME_CREATED" }],
    ["an array verdict", { ownership: [] }],
    ["an unknown class", { ownership: ownership({ ownership: "ADMIN" }) }],
    ["a lowercase class", { ownership: ownership({ ownership: "third_party" }) }],
    ["a non-boolean flag", { ownership: ownership({ modifiable: "false" }) }],
    ["a missing flag", { ownership: ownership({ modifiable: undefined }) }],
    ["an unknown reason", { ownership: ownership({ readOnlyReasons: ["BECAUSE"] }) }],
    ["reasons that are not a list", { ownership: ownership({ readOnlyReasons: "NOT_ADOPTED" }) }],
    ["too many reasons", { ownership: ownership({ readOnlyReasons: Array(17).fill("NOT_ADOPTED") }) }],
    ["unknown evidence", { ownership: ownership({ evidence: ["TRUST_ME"] }) }],
    ["no evidence at all", { ownership: ownership({ evidence: [] }) }],
    ["too much evidence", { ownership: ownership({ evidence: Array(33).fill("DOMAIN_GUI") }) }],
    ["read-only without a reason", { ownership: ownership({ readOnlyReasons: [] }) }],
    [
      "modifiable with a reason",
      { ownership: ownership({ ownership: "USERHOME_CREATED", modifiable: true }) },
    ],
  ])("rejects a service with %s", (_name, overrides) => {
    expect(() => decodeLaunchdService(service(overrides))).toThrow();
  });

  it.each([
    "CURRENT_USER_AGENT",
    "GLOBAL_AGENT",
    "SYSTEM_DAEMON",
    "APPLE_MANAGED",
    "THIRD_PARTY",
  ])("never accepts %s as modifiable", (kind) => {
    expect(() =>
      decodeLaunchdService(
        service({
          ownership: ownership({
            ownership: kind,
            modifiable: true,
            readOnlyReasons: [],
          }),
        }),
      ),
    ).toThrow();
  });

  it("rejects a modifiable verdict that contradicts the service's own evidence", () => {
    const claim = createdService().ownership;
    const cases: Record<string, unknown>[] = [
      { domain: "SYSTEM", domainTarget: "system" },
      { configFiles: [] },
      {
        configFiles: [
          configFile({ directory: "GLOBAL_LAUNCH_AGENTS", scope: "GLOBAL_AGENT" }),
        ],
      },
      {
        configFiles: [
          configFile({ directory: "APPLE_LAUNCH_AGENTS", isApplePath: true }),
        ],
      },
      { configFiles: [configFile({ kind: "LINK", parseStatus: "LINK_NOT_READ" })] },
      { configFiles: [configFile(), configFile()] },
      { label: "com.apple.forged", id: "gui/501/com.apple.forged" },
      { label: "com.example.agent" },
    ];
    for (const overrides of cases) {
      expect(
        () => decodeLaunchdService(createdService({ ownership: claim, ...overrides })),
        JSON.stringify(overrides),
      ).toThrow();
    }
  });
});

function discoveryWith(services: unknown[]) {
  return discovery({ services });
}
