import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeResidentCaddySnapshot,
  getResidentCaddySnapshot,
} from "./servicesSnapshot";

afterEach(() => {
  clearMocks();
});

function instanceWire(overrides: Record<string, unknown> = {}) {
  return {
    label: "com.example.web",
    domain: "GUI",
    scope: "USER_AGENT",
    ownership: "CURRENT_USER_AGENT",
    plistPath: "~/Library/LaunchAgents/com.example.web.plist",
    executable: "/opt/homebrew/bin/caddy",
    arguments: ["/opt/homebrew/bin/caddy", "run", "--api-key", "[REDACTED]"],
    adapter: "caddyfile",
    config: { path: "~/Sites/Caddyfile", flag: "LONG", unknownReason: null },
    loadState: "LOADED",
    runState: "RUNNING",
    pid: 42,
    observedAtMs: 1700000000000,
    complete: true,
    incompleteReasons: [],
    ...overrides,
  };
}

function sourceWire(overrides: Record<string, unknown> = {}) {
  return {
    source: "LAUNCHCTL_LIST",
    status: "COMPLETE",
    reason: null,
    ...overrides,
  };
}

function snapshotWire(overrides: Record<string, unknown> = {}) {
  return {
    observedAtMs: 1700000000000,
    complete: true,
    canConcludeAbsence: true,
    sources: [sourceWire()],
    instances: [instanceWire()],
    ...overrides,
  };
}

describe("decodeResidentCaddySnapshot", () => {
  it("decodes a running instance with its argv and a stated config path", () => {
    const snapshot = decodeResidentCaddySnapshot(snapshotWire());

    expect(snapshot.complete).toBe(true);
    expect(snapshot.canConcludeAbsence).toBe(true);
    expect(snapshot.instances[0]).toMatchObject({
      label: "com.example.web",
      runState: "RUNNING",
      pid: 42,
      config: { path: "~/Sites/Caddyfile", flag: "LONG" },
    });
  });

  it("decodes a complete empty snapshot, which concludes absence", () => {
    const snapshot = decodeResidentCaddySnapshot(snapshotWire({ instances: [] }));

    expect(snapshot.instances).toEqual([]);
    expect(snapshot.canConcludeAbsence).toBe(true);
  });

  it("decodes an incomplete instance whose config location is unknown", () => {
    const snapshot = decodeResidentCaddySnapshot(
      snapshotWire({
        complete: false,
        canConcludeAbsence: false,
        sources: [sourceWire({ status: "FAILED", reason: "PROCESS_FAILED" })],
        instances: [
          instanceWire({
            config: { path: null, flag: null, unknownReason: "MISSING" },
            loadState: "UNKNOWN",
            runState: "UNKNOWN",
            pid: null,
            complete: false,
            incompleteReasons: ["LOAD_STATE_UNKNOWN", "SOURCE_INCOMPLETE"],
          }),
        ],
      }),
    );

    expect(snapshot.canConcludeAbsence).toBe(false);
    expect(snapshot.instances[0].config.unknownReason).toBe("MISSING");
    expect(snapshot.instances[0].pid).toBeUndefined();
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown domain", snapshotWire({ instances: [instanceWire({ domain: "USER" })] })],
    [
      "an unknown ownership",
      snapshotWire({ instances: [instanceWire({ ownership: "MINE" })] }),
    ],
    [
      "an unknown source status",
      snapshotWire({ sources: [sourceWire({ status: "OK" })] }),
    ],
    [
      "an unknown incomplete reason",
      snapshotWire({
        complete: false,
        canConcludeAbsence: false,
        instances: [
          instanceWire({
            complete: false,
            incompleteReasons: ["GUESSED"],
          }),
        ],
      }),
    ],
    [
      "a complete snapshot with a failed source",
      snapshotWire({ sources: [sourceWire({ status: "FAILED", reason: "IO" })] }),
    ],
    [
      "absence concluded while the snapshot is incomplete",
      snapshotWire({ complete: false, canConcludeAbsence: true }),
    ],
    [
      "a complete instance that lists reasons",
      snapshotWire({
        instances: [instanceWire({ incompleteReasons: ["PLIST_UNPARSED"] })],
      }),
    ],
    [
      "an incomplete instance without a reason",
      snapshotWire({
        complete: false,
        canConcludeAbsence: false,
        instances: [instanceWire({ complete: false, incompleteReasons: [] })],
      }),
    ],
    [
      "a complete snapshot holding an incomplete instance",
      snapshotWire({
        instances: [
          instanceWire({ complete: false, incompleteReasons: ["PLIST_UNPARSED"] }),
        ],
      }),
    ],
    [
      "a PID on a job that is not running",
      snapshotWire({ instances: [instanceWire({ runState: "NOT_RUNNING", pid: 42 })] }),
    ],
    [
      "a running job that is not loaded",
      snapshotWire({
        instances: [instanceWire({ loadState: "NOT_LOADED", runState: "RUNNING" })],
      }),
    ],
    [
      "a config path without its flag",
      snapshotWire({
        instances: [
          instanceWire({ config: { path: "/etc/Caddyfile", flag: null, unknownReason: null } }),
        ],
      }),
    ],
    [
      "a config path together with an unknown reason",
      snapshotWire({
        instances: [
          instanceWire({
            config: { path: "/etc/Caddyfile", flag: "SHORT", unknownReason: "AMBIGUOUS" },
          }),
        ],
      }),
    ],
    [
      "no config path and no reason",
      snapshotWire({
        instances: [instanceWire({ config: { path: null, flag: null, unknownReason: null } })],
      }),
    ],
    [
      "an unknown config flag form",
      snapshotWire({
        instances: [
          instanceWire({ config: { path: "/etc/Caddyfile", flag: "POSITIONAL", unknownReason: null } }),
        ],
      }),
    ],
    [
      "a negative PID",
      snapshotWire({ instances: [instanceWire({ pid: -1 })] }),
    ],
    [
      "a non-boolean complete flag",
      snapshotWire({ complete: "yes" }),
    ],
    [
      "more sources than the backend can send",
      snapshotWire({ sources: Array.from({ length: 17 }, () => sourceWire()) }),
    ],
    [
      "more arguments than the backend can send",
      snapshotWire({
        instances: [instanceWire({ arguments: Array.from({ length: 129 }, () => "x") })],
      }),
    ],
    [
      "instances that are not a list",
      snapshotWire({ instances: "none" }),
    ],
  ])("rejects a malformed snapshot: %s", (_name, payload) => {
    expect(() => decodeResidentCaddySnapshot(payload)).toThrow();
  });
});

describe("getResidentCaddySnapshot", () => {
  it("calls the read-only command with no input and decodes its result", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return snapshotWire();
    });

    const snapshot = await getResidentCaddySnapshot();

    expect(seen?.command).toBe("get_resident_caddy_snapshot");
    expect(snapshot.instances).toHaveLength(1);
  });

  it("passes a busy discovery through as a conflict, not as a result", async () => {
    mockIPC(() => {
      throw {
        code: "CONFLICT",
        message: "launchd discovery is already running. Retry when it finishes.",
        retryable: false,
      };
    });

    await expect(getResidentCaddySnapshot()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("fails closed when the command returns a malformed payload", async () => {
    mockIPC(() => snapshotWire({ canConcludeAbsence: true, complete: false }));

    await expect(getResidentCaddySnapshot()).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
