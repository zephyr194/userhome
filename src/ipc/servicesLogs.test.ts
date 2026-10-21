import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  authorizeLaunchdLog,
  confirmLaunchdLogExport,
  decodeLogGrantSummary,
  decodeLogSnapshot,
  discardLaunchdLogExport,
  prepareLaunchdLogExport,
  readLaunchdLogSince,
  readLaunchdLogTail,
  revokeLaunchdLog,
  type LogTarget,
} from "./services";

const GRANT = "7f3b1d2e-5a6c-4e8f-9b0a-1c2d3e4f5a6b";
const TARGET: LogTarget = {
  domain: "GUI",
  label: "com.example.job",
  stream: "STDOUT",
};

afterEach(() => {
  clearMocks();
});

function wireSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    state: "CONTENT",
    text: "line\n",
    skippedBytes: 0,
    headTrimmed: false,
    lossy: false,
    reset: null,
    nextOffset: 5,
    fileSize: 5,
    identity: { device: 1, inode: 2 },
    ...overrides,
  };
}

describe("decodeLogSnapshot", () => {
  it("accepts a content snapshot and a missing one", () => {
    expect(decodeLogSnapshot(wireSnapshot()).identity).toEqual({
      device: 1,
      inode: 2,
    });
    expect(
      decodeLogSnapshot({
        state: "MISSING",
        text: "",
        skippedBytes: 0,
        headTrimmed: false,
        lossy: false,
        reset: null,
        nextOffset: 0,
        fileSize: 0,
        identity: null,
      }).state,
    ).toBe("MISSING");
  });

  it("refuses a snapshot whose parts disagree", () => {
    expect(() => decodeLogSnapshot(wireSnapshot({ state: "NOPE" }))).toThrow();
    expect(() => decodeLogSnapshot(wireSnapshot({ identity: null }))).toThrow();
    expect(() =>
      decodeLogSnapshot(
        wireSnapshot({ state: "MISSING", identity: null, text: "x" }),
      ),
    ).toThrow();
    expect(() => decodeLogSnapshot(wireSnapshot({ text: 5 }))).toThrow();
    expect(() => decodeLogSnapshot(wireSnapshot({ nextOffset: -1 }))).toThrow();
    expect(() =>
      decodeLogSnapshot(wireSnapshot({ nextOffset: 1.5 })),
    ).toThrow();
    expect(() => decodeLogSnapshot(wireSnapshot({ reset: "UNKNOWN" }))).toThrow();
    expect(() =>
      decodeLogSnapshot(wireSnapshot({ identity: { device: "1", inode: 2 } })),
    ).toThrow();
    expect(() => decodeLogSnapshot(null)).toThrow();
  });
});

describe("decodeLogGrantSummary", () => {
  it("returns only the id and the display path", () => {
    const summary = decodeLogGrantSummary({
      grantId: GRANT,
      displayPath: "~/Library/Logs/job.log",
      path: "/Users/me/Library/Logs/job.log",
    });
    expect(summary).toEqual({
      grantId: GRANT,
      displayPath: "~/Library/Logs/job.log",
    });
  });

  it("refuses an empty or oversized id", () => {
    expect(() =>
      decodeLogGrantSummary({ grantId: "", displayPath: "~/x" }),
    ).toThrow();
    expect(() =>
      decodeLogGrantSummary({ grantId: "x".repeat(65), displayPath: "~/x" }),
    ).toThrow();
  });
});

describe("log commands", () => {
  it("authorizes by domain and label and returns null when cancelled", async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return command === "authorize_launchd_log"
        ? null
        : undefined;
    });
    await expect(authorizeLaunchdLog(TARGET)).resolves.toBeNull();
    expect(calls[0]).toEqual({
      command: "authorize_launchd_log",
      payload: {
        target: { domain: "GUI", label: "com.example.job", stream: "STDOUT" },
      },
    });
  });

  it("sends only the allowed fields, never a path a caller adds", async () => {
    const seen: unknown[] = [];
    mockIPC((_command, payload) => {
      seen.push(payload);
      return wireSnapshot();
    });
    await readLaunchdLogTail(
      { ...TARGET, path: "/etc/passwd" } as unknown as LogTarget,
      GRANT,
      4096,
    );
    expect(seen[0]).toEqual({
      input: {
        target: { domain: "GUI", label: "com.example.job", stream: "STDOUT" },
        grantId: GRANT,
        maxBytes: 4096,
      },
    });
  });

  it("refuses malformed requests before anything is sent", async () => {
    let sent = false;
    mockIPC(() => {
      sent = true;
      return null;
    });
    await expect(
      authorizeLaunchdLog({ ...TARGET, label: "bad/label" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      authorizeLaunchdLog({ ...TARGET, stream: "STDIN" as never }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      readLaunchdLogTail(TARGET, GRANT, 0),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      readLaunchdLogTail(TARGET, GRANT, 2 * 1024 * 1024),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(revokeLaunchdLog("")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(sent).toBe(false);
  });

  it("sends the cursor for an incremental read", async () => {
    const seen: unknown[] = [];
    mockIPC((command, payload) => {
      seen.push({ command, payload });
      return wireSnapshot();
    });
    await readLaunchdLogSince(TARGET, GRANT, {
      offset: 9,
      device: 1,
      inode: 2,
    });
    expect(seen[0]).toEqual({
      command: "read_launchd_log_since",
      payload: {
        input: {
          target: { domain: "GUI", label: "com.example.job", stream: "STDOUT" },
          grantId: GRANT,
          offset: 9,
          device: 1,
          inode: 2,
        },
      },
    });
  });

  it("revokes a grant by id", async () => {
    const seen: unknown[] = [];
    mockIPC((command, payload) => {
      seen.push({ command, payload });
      return undefined;
    });
    await revokeLaunchdLog(GRANT);
    expect(seen[0]).toEqual({
      command: "revoke_launchd_log",
      payload: { input: { grantId: GRANT } },
    });
  });

  it("previews an export and returns null when the save dialog was cancelled", async () => {
    mockIPC((command) => {
      if (command === "prepare_launchd_log_export") return null;
      return undefined;
    });
    await expect(prepareLaunchdLogExport(TARGET, GRANT)).resolves.toBeNull();
  });

  it("decodes an export preview and a write outcome", async () => {
    mockIPC((command) => {
      if (command === "prepare_launchd_log_export") {
        return {
          operationId: "op-1",
          expiresAt: "2026-10-21T12:00:00Z",
          replaces: false,
          save: { grantId: GRANT, displayPath: "~/Desktop/job.txt" },
        };
      }
      if (command === "confirm_launchd_log_export") {
        return {
          kind: "CREATE",
          status: "SUCCEEDED",
          fileState: "WRITTEN",
          recoveryPoint: "NONE_CREATED",
          summary: "Wrote the export.",
        };
      }
      return undefined;
    });
    const preview = await prepareLaunchdLogExport(TARGET, GRANT);
    expect(preview?.save.displayPath).toBe("~/Desktop/job.txt");
    const outcome = await confirmLaunchdLogExport("op-1", GRANT);
    expect(outcome.status).toBe("SUCCEEDED");
  });

  it("discards a previewed export by operation and grant", async () => {
    const seen: unknown[] = [];
    mockIPC((command, payload) => {
      seen.push({ command, payload });
      return undefined;
    });
    await discardLaunchdLogExport("op-1", GRANT);
    expect(seen[0]).toEqual({
      command: "discard_launchd_log_export",
      payload: { input: { operationId: "op-1", grantId: GRANT } },
    });
  });
});
