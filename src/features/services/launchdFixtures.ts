import type {
  LaunchdConfigFile,
  LaunchdDiscovery,
  LaunchdService,
  LaunchdSourceReport,
} from "../../ipc/services";

/** Test fixtures for the launchd discovery shapes; no real launchd state. */

export function configFile(
  overrides: Partial<LaunchdConfigFile> = {},
): LaunchdConfigFile {
  return {
    path: "~/Library/LaunchAgents/com.example.agent.plist",
    directory: "USER_LAUNCH_AGENTS",
    scope: "USER_AGENT",
    isApplePath: false,
    ownerUid: 501,
    kind: "REGULAR",
    parseStatus: "PARSED",
    details: {
      program: "/usr/local/bin/example",
      programArguments: ["/usr/local/bin/example", "--serve", "--token=••••"],
      argumentsTruncated: false,
      environmentKeys: ["API_TOKEN", "PORT"],
      runAtLoad: true,
      keepAlive: { mode: "CONDITIONAL", conditions: ["SuccessfulExit"] },
      standardOutPath: "~/Library/Logs/example.out.log",
      standardErrorPath: "~/Library/Logs/example.err.log",
      disabled: false,
      userName: "alice",
    },
    ...overrides,
  };
}

export function launchdService(
  overrides: Partial<LaunchdService> = {},
): LaunchdService {
  return {
    id: "gui/501/com.example.agent",
    label: "com.example.agent",
    labelSource: "LAUNCHCTL",
    domain: "GUI",
    domainTarget: "gui/501",
    scope: "USER_AGENT",
    correlation: "MATCHED",
    loadState: "LOADED",
    runState: "RUNNING",
    pid: 4242,
    lastExit: { kind: "CODE", value: 0 },
    configPresence: "FOUND",
    configFiles: [configFile()],
    issues: [],
    ...overrides,
  };
}

export function sourceReport(
  overrides: Partial<LaunchdSourceReport> = {},
): LaunchdSourceReport {
  return {
    source: "LAUNCHCTL_LIST",
    status: "COMPLETE",
    items: 12,
    failedFiles: 0,
    ...overrides,
  };
}

export const COMPLETE_SOURCES: LaunchdSourceReport[] = [
  sourceReport({ source: "LAUNCHCTL_LIST", items: 3 }),
  sourceReport({ source: "LAUNCHCTL_PRINT_SYSTEM", items: 1 }),
  sourceReport({ source: "USER_LAUNCH_AGENTS", items: 1 }),
  sourceReport({
    source: "GLOBAL_LAUNCH_AGENTS",
    reason: "DIRECTORY_MISSING",
    items: 0,
  }),
  sourceReport({ source: "GLOBAL_LAUNCH_DAEMONS", items: 1 }),
  sourceReport({ source: "APPLE_LAUNCH_AGENTS", items: 0 }),
  sourceReport({ source: "APPLE_LAUNCH_DAEMONS", items: 0 }),
];

/** A mixed inventory covering every correlation and scope class. */
export function sampleServices(): LaunchdService[] {
  return [
    launchdService(),
    launchdService({
      id: "gui/501/com.example.idle",
      label: "com.example.idle",
      runState: "NOT_RUNNING",
      pid: undefined,
      lastExit: { kind: "CODE", value: 78 },
      configFiles: [
        configFile({
          path: "~/Library/LaunchAgents/com.example.idle.plist",
        }),
      ],
    }),
    launchdService({
      id: "gui/501/com.example.disabled",
      label: "com.example.disabled",
      labelSource: "PLIST",
      correlation: "FILE_ONLY",
      loadState: "NOT_LOADED",
      runState: "NOT_RUNNING",
      pid: undefined,
      lastExit: undefined,
      configFiles: [
        configFile({
          path: "~/Library/LaunchAgents/com.example.disabled.plist",
        }),
      ],
    }),
    launchdService({
      id: "system/com.vendor.daemon",
      label: "com.vendor.daemon",
      domain: "SYSTEM",
      domainTarget: "system",
      scope: "SYSTEM_DAEMON",
      pid: 77,
      lastExit: undefined,
      configFiles: [
        configFile({
          path: "/Library/LaunchDaemons/com.vendor.daemon.plist",
          directory: "GLOBAL_LAUNCH_DAEMONS",
          scope: "SYSTEM_DAEMON",
          ownerUid: 0,
          details: {
            programArguments: ["/Library/Vendor/daemon"],
            argumentsTruncated: false,
            environmentKeys: [],
          },
        }),
      ],
    }),
    launchdService({
      id: "system/com.apple.metadata.mds",
      label: "com.apple.metadata.mds",
      domain: "SYSTEM",
      domainTarget: "system",
      scope: "APPLE_DAEMON",
      correlation: "LOADED_ONLY",
      configPresence: "NOT_FOUND_IN_SCANNED",
      pid: 91,
      lastExit: undefined,
      configFiles: [],
    }),
    launchdService({
      id: "gui/501/!file/USER_LAUNCH_AGENTS/broken.plist",
      label: "broken",
      labelSource: "FILE_NAME",
      correlation: "UNMATCHED_FILE",
      loadState: "UNKNOWN",
      runState: "UNKNOWN",
      pid: undefined,
      lastExit: undefined,
      configPresence: "UNKNOWN",
      issues: ["MISSING_LABEL"],
      configFiles: [
        configFile({
          path: "~/Library/LaunchAgents/broken.plist",
          kind: "LINK",
          linkTarget: { state: "OUTSIDE", display: "~/dev/broken.plist" },
          parseStatus: "LINK_NOT_READ",
          details: undefined,
        }),
      ],
    }),
  ];
}

export function sampleDiscovery(
  overrides: Partial<LaunchdDiscovery> = {},
): LaunchdDiscovery {
  return {
    services: sampleServices(),
    sources: COMPLETE_SOURCES,
    complete: true,
    truncated: false,
    ...overrides,
  };
}

export function partialDiscovery(): LaunchdDiscovery {
  return sampleDiscovery({
    complete: false,
    sources: [
      ...COMPLETE_SOURCES.filter(
        (report) => report.source !== "LAUNCHCTL_PRINT_SYSTEM",
      ),
      sourceReport({
        source: "LAUNCHCTL_PRINT_SYSTEM",
        status: "INACCESSIBLE",
        reason: "PERMISSION_DENIED",
        items: 0,
      }),
    ],
  });
}
