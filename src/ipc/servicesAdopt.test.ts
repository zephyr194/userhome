import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeAdoptExecution,
  decodeAdoptPreview,
  decodeEditExecution,
  decodeEditPreview,
  decodeReleaseOutcome,
  discardEditLaunchdService,
  executeEditLaunchdService,
  previewAdoptLaunchdService,
  previewEditLaunchdService,
  releaseAdoption,
  type EditServiceRequest,
} from "./servicesAdopt";

const LABEL = "com.vendor.backup";
const FILE = `~/Library/LaunchAgents/${LABEL}.plist`;
const HASH = "a".repeat(64);

function wireOperation(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: `接管任务 ${LABEL}`,
    effects: ["配置：~/Library/LaunchAgents/x.plist"],
    expiresAt: "2026-10-20T10:05:00Z",
    status: "PREVIEWED",
    events: [],
    ...overrides,
  };
}

function wireAdoptPreview(overrides: Record<string, unknown> = {}) {
  const { operationId, summary, effects, expiresAt } = wireOperation();
  return {
    operationId,
    summary,
    effects,
    expiresAt,
    label: LABEL,
    domain: "GUI",
    source: "~/Library/LaunchAgents（当前用户）",
    filePath: FILE,
    backup: "执行前把原始 plist 备份到 UserHome 备份目录。",
    changedFields: [],
    externalManagerNote: "若由 Homebrew services 管理，它们可能重写此文件。",
    effectNote: "接管只记录所有权，不修改 plist 内容，也不加载或重启任务。",
    ...overrides,
  };
}

function wireAdoptExecution(overrides: Record<string, unknown> = {}) {
  return {
    ...wireOperation({ status: "SUCCEEDED" }),
    label: LABEL,
    domain: "GUI",
    filePath: FILE,
    backupId: "adopt-0123456789abcdef0123456789abcdef",
    plistChanged: false,
    effectNote: "接管只记录所有权，不修改 plist 内容，也不加载或重启任务。",
    ...overrides,
  };
}

function wireEditPreview(overrides: Record<string, unknown> = {}) {
  return {
    ...wireOperation(),
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: FILE,
    currentHash: HASH,
    proposedHash: "b".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    label: LABEL,
    domain: "GUI",
    filePath: FILE,
    changes: ["ProgramArguments", "EnvironmentVariables"],
    executable: "/usr/local/bin/tool",
    arguments: ["--name", "x"],
    environmentSet: ["MODE"],
    environmentRemoved: ["OLD"],
    backup: "执行前把原始 plist 备份到 UserHome 备份目录。",
    reloadNote: "配置已保存，需重新加载任务才生效；本步不会加载或重启。",
    ...overrides,
  };
}

function wireEditExecution(overrides: Record<string, unknown> = {}) {
  return {
    ...wireOperation({ status: "SUCCEEDED" }),
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      backupId: "backup-1",
      summary: "The file was written and verified.",
    },
    label: LABEL,
    domain: "GUI",
    filePath: FILE,
    reloadRequired: true,
    reloadNote: "配置已保存，需重新加载任务才生效；本步不会加载或重启。",
    ...overrides,
  };
}

const EDIT_REQUEST: EditServiceRequest = {
  domain: "GUI",
  label: LABEL,
  executable: "/usr/local/bin/tool",
  environmentSet: { MODE: "fast" },
  environmentRemove: ["OLD"],
  runAtLoad: true,
};

afterEach(() => {
  clearMocks();
});

describe("adoption decoding", () => {
  it("decodes a preview that changes no field", () => {
    expect(decodeAdoptPreview(wireAdoptPreview())).toMatchObject({
      label: LABEL,
      domain: "GUI",
      filePath: FILE,
      changedFields: [],
    });
  });

  it("refuses a preview that claims a changed field or a malformed job", () => {
    const bad: Record<string, unknown>[] = [
      { changedFields: ["RunAtLoad"] },
      { changedFields: "none" },
      { domain: "SYSTEM" },
      { label: "a/b" },
      { label: "" },
      { filePath: "Library/LaunchAgents/x.plist" },
      { source: "" },
      { backup: "bad\u0007text" },
      { effectNote: "x".repeat(2000) },
      { operationId: 5 },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeAdoptPreview(wireAdoptPreview(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
    expect(() => decodeAdoptPreview(null)).toThrow();
  });

  it("decodes a confirmed adoption and refuses a success that changed the plist", () => {
    expect(decodeAdoptExecution(wireAdoptExecution())).toMatchObject({
      backupId: expect.any(String),
      plistChanged: false,
    });
    expect(() => decodeAdoptExecution(wireAdoptExecution({ plistChanged: true }))).toThrow();
    expect(() =>
      decodeAdoptExecution(wireAdoptExecution({ status: "FAILED" })),
    ).toThrow();
    expect(() => decodeAdoptExecution(wireAdoptExecution({ backupId: "" }))).toThrow();
    expect(() => decodeAdoptExecution(wireAdoptExecution({ filePath: 3 }))).toThrow();
  });

  it("decodes a release and refuses one that claims the plist changed", () => {
    expect(
      decodeReleaseOutcome({ label: LABEL, domain: "GUI", released: true, plistChanged: false }),
    ).toEqual({ label: LABEL, domain: "GUI", released: true, plistChanged: false });
    expect(() =>
      decodeReleaseOutcome({ label: LABEL, domain: "GUI", released: true, plistChanged: true }),
    ).toThrow();
    expect(() =>
      decodeReleaseOutcome({ label: LABEL, domain: "GUI", released: "yes", plistChanged: false }),
    ).toThrow();
  });
});

describe("edit decoding", () => {
  it("decodes a preview and keeps environment names only", () => {
    const preview = decodeEditPreview(wireEditPreview());
    expect(preview).toMatchObject({
      changes: ["ProgramArguments", "EnvironmentVariables"],
      environmentSet: ["MODE"],
      environmentRemoved: ["OLD"],
      reloadNote: expect.any(String),
    });
  });

  it("refuses a preview with an unknown change key or a contradictory field set", () => {
    const bad: Record<string, unknown>[] = [
      { changes: ["Label"] },
      { changes: [] },
      { changes: ["RunAtLoad", "RunAtLoad"] },
      // A program change must come with both the executable and the arguments.
      { changes: ["ProgramArguments"], executable: undefined, arguments: ["x"] },
      { changes: ["ProgramArguments"], arguments: undefined },
      { changes: ["RunAtLoad"] },
      // Environment names must be listed exactly when the environment changes.
      { changes: ["RunAtLoad"], executable: undefined, arguments: undefined, environmentSet: [], environmentRemoved: ["X"] },
      { changes: ["EnvironmentVariables"], environmentSet: [], environmentRemoved: [] },
      { environmentSet: ["bad-key"] },
      { environmentSet: ["MODE", "MODE"] },
      { arguments: ["a".repeat(5000)] },
      { kind: "CREATE" },
      { reloadNote: "" },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeEditPreview(wireEditPreview(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
  });

  it("decodes a successful write and refuses a success the operation does not confirm", () => {
    expect(decodeEditExecution(wireEditExecution())).toMatchObject({
      reloadRequired: true,
      outcome: { status: "SUCCEEDED", fileState: "WRITTEN" },
    });
    expect(() => decodeEditExecution(wireEditExecution({ reloadRequired: false }))).toThrow();
    expect(() => decodeEditExecution(wireEditExecution({ status: "FAILED" }))).toThrow();
    expect(() =>
      decodeEditExecution(
        wireEditExecution({
          outcome: {
            kind: "REPLACE",
            status: "FAILED",
            fileState: "RESTORED",
            recoveryPoint: "BACKUP",
            backupId: "backup-1",
            summary: "Restored.",
          },
        }),
      ),
    ).toThrow();
  });
});

describe("request shape on the wire", () => {
  it("sends only the domain and label for an adoption preview", async () => {
    let sent: unknown;
    mockIPC((command, payload) => {
      if (command === "preview_adopt_launchd_service") {
        sent = payload;
        return wireAdoptPreview();
      }
      return undefined;
    });
    await previewAdoptLaunchdService({ domain: "GUI", label: LABEL });
    expect(sent).toEqual({ input: { domain: "GUI", label: LABEL } });
  });

  it("refuses a request with a bad label before anything is sent", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return undefined;
    });
    await expect(
      previewAdoptLaunchdService({ domain: "GUI", label: "../x" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(releaseAdoption({ domain: "SYSTEM" as "GUI", label: LABEL })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(called).toBe(false);
  });

  it("drops fields the edit contract does not name", async () => {
    let sent: { input: Record<string, unknown> } | undefined;
    mockIPC((command, payload) => {
      if (command === "preview_edit_launchd_service") {
        sent = payload as { input: Record<string, unknown> };
        return wireEditPreview();
      }
      return undefined;
    });
    const unexpected = { plistPath: "/etc/x.plist", uid: 0 };
    await previewEditLaunchdService({ ...EDIT_REQUEST, ...unexpected });
    expect(sent?.input).toEqual({
      domain: "GUI",
      label: LABEL,
      executable: "/usr/local/bin/tool",
      environmentSet: { MODE: "fast" },
      environmentRemove: ["OLD"],
      runAtLoad: true,
    });
  });

  it("confirms a preview by its operation id only", async () => {
    let sent: unknown;
    mockIPC((command, payload) => {
      if (command === "execute_edit_launchd_service") {
        sent = payload;
        return wireEditExecution();
      }
      return undefined;
    });
    await executeEditLaunchdService("op-1");
    expect(sent).toEqual({ operationId: "op-1" });
    await expect(executeEditLaunchdService("")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("accepts an empty discard and refuses a discard that returns data", async () => {
    mockIPC(() => null);
    await expect(discardEditLaunchdService("op-1")).resolves.toBeUndefined();
    mockIPC(() => ({ unexpected: true }));
    await expect(discardEditLaunchdService("op-1")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("turns a malformed success payload into an internal error", async () => {
    mockIPC(() => wireAdoptExecution({ plistChanged: true }));
    await expect(releaseAdoption({ domain: "GUI", label: LABEL })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
