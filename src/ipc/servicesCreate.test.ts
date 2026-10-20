import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  CREATE_SERVICE_NAMESPACE,
  decodeCreateServiceExecution,
  decodeCreateServicePreview,
  executeCreateLaunchdService,
  previewCreateLaunchdService,
  type CreateServiceRequest,
} from "./services";

const LABEL = `${CREATE_SERVICE_NAMESPACE}backup`;
const FILE = `~/Library/LaunchAgents/${LABEL}.plist`;
const HASH = "c".repeat(64);

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: `Create ${FILE}.`,
    effects: [`Target: ${FILE}`],
    requiresElevation: false,
    expiresAt: "2026-10-20T10:05:00Z",
    kind: "CREATE",
    recoveryPoint: "NONE_CREATED",
    target: FILE,
    proposedHash: HASH,
    diff: { lines: [], redacted: true, truncated: false },
    label: LABEL,
    filePath: FILE,
    executable: "/usr/local/bin/tool",
    arguments: ["--token=[REDACTED]", "--name", "x"],
    argumentsRedacted: true,
    workingDirectory: "~/work",
    environmentKeys: ["API_KEY", "MODE"],
    stdoutPath: "~/logs/out.log",
    runAtLoad: false,
    keepAlive: false,
    persistenceNotes: ["登录后自动启动：已关闭。", "退出后自动重启：已关闭。"],
    effectNote: "仅创建配置文件，本步不加载、不启动。",
    ...overrides,
  };
}

function wireExecution(overrides: Record<string, unknown> = {}) {
  const { operationId, summary, effects, requiresElevation, expiresAt } = wirePreview();
  return {
    operationId,
    summary,
    effects,
    requiresElevation,
    expiresAt,
    status: "SUCCEEDED",
    events: [],
    outcome: {
      kind: "CREATE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "NONE_CREATED",
      summary: "The file was written and verified.",
    },
    label: LABEL,
    filePath: FILE,
    loaded: false,
    effectNote: "配置文件已创建。新任务尚未加载，也未启动。",
    ...overrides,
  };
}

const REQUEST: CreateServiceRequest = {
  label: "backup",
  executable: "/usr/local/bin/tool",
  arguments: ["--name", "x"],
  environment: { API_KEY: "s3cret-value" },
  runAtLoad: false,
  keepAlive: false,
};

afterEach(() => {
  clearMocks();
});

describe("create launchd service preview decoding", () => {
  it("decodes a creation preview", () => {
    const preview = decodeCreateServicePreview(wirePreview());
    expect(preview).toMatchObject({
      label: LABEL,
      filePath: FILE,
      kind: "CREATE",
      executable: "/usr/local/bin/tool",
      arguments: ["--token=[REDACTED]", "--name", "x"],
      argumentsRedacted: true,
      workingDirectory: "~/work",
      environmentKeys: ["API_KEY", "MODE"],
      stdoutPath: "~/logs/out.log",
      runAtLoad: false,
      keepAlive: false,
    });
    expect(preview.stderrPath).toBeUndefined();
    expect(preview.persistenceNotes).toHaveLength(2);
  });

  it("never carries environment values", () => {
    for (const extra of [
      { environment: { API_KEY: "s3cret-value" } },
      { environmentValues: ["s3cret-value"] },
    ]) {
      expect(() => decodeCreateServicePreview(wirePreview(extra))).toThrow();
    }
  });

  it("refuses a preview that is not a redacted creation of the fixed file", () => {
    const bad: Record<string, unknown>[] = [
      { kind: "REPLACE", recoveryPoint: "BACKUP", currentHash: HASH },
      { diff: { lines: [], redacted: false, truncated: false } },
      { diff: { lines: [{ kind: "ADDED", text: "secret" }], redacted: true, truncated: false } },
      { label: "com.apple.forged", filePath: "~/Library/LaunchAgents/com.apple.forged.plist" },
      { label: `${CREATE_SERVICE_NAMESPACE}` },
      { filePath: "~/Library/LaunchAgents/other.plist" },
      { filePath: `/etc/${LABEL}.plist` },
      { target: "~/Library/LaunchAgents/other.plist" },
      { environmentKeys: ["bad-key"] },
      { environmentKeys: Array.from({ length: 33 }, (_, index) => `K${index}`) },
      { environmentKeys: ["A", "A"] },
      { arguments: Array.from({ length: 65 }, () => "a") },
      { arguments: ["a\nb"] },
      { arguments: ["x".repeat(4097)] },
      { arguments: "not-a-list" },
      { argumentsRedacted: "yes" },
      { runAtLoad: "no" },
      { keepAlive: 0 },
      { persistenceNotes: [] },
      { persistenceNotes: "text" },
      { effectNote: "" },
      { executable: "relative/tool" },
      { executable: "" },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeCreateServicePreview(wirePreview(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
    expect(() => decodeCreateServicePreview(null)).toThrow();
    expect(() => decodeCreateServicePreview("x")).toThrow();
  });
});

describe("create launchd service execution decoding", () => {
  it("decodes the written result and says nothing was loaded", () => {
    const execution = decodeCreateServiceExecution(wireExecution());
    expect(execution).toMatchObject({
      label: LABEL,
      filePath: FILE,
      loaded: false,
      status: "SUCCEEDED",
    });
    expect(execution.outcome.fileState).toBe("WRITTEN");
  });

  it("refuses a result that claims the job was loaded or points elsewhere", () => {
    for (const overrides of [
      { loaded: true },
      { loaded: "no" },
      { label: "com.apple.forged" },
      { filePath: "~/other.plist" },
      { effectNote: "" },
      { outcome: undefined },
    ]) {
      expect(() => decodeCreateServiceExecution(wireExecution(overrides))).toThrow();
    }
  });
});

describe("create launchd service commands", () => {
  it("sends only the typed request fields to the preview command", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return wirePreview();
    });

    const preview = await previewCreateLaunchdService({
      ...REQUEST,
      // A caller cannot smuggle a path or a user in.
      ...({ plistPath: "/etc/x", userName: "root" } as object),
    } as CreateServiceRequest);

    expect(preview.label).toBe(LABEL);
    expect(seen?.command).toBe("preview_create_launchd_service");
    expect(seen?.payload).toEqual({
      input: {
        label: "backup",
        executable: "/usr/local/bin/tool",
        arguments: ["--name", "x"],
        environment: { API_KEY: "s3cret-value" },
        runAtLoad: false,
        keepAlive: false,
      },
    });
  });

  it("rejects a malformed request before calling the backend", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wirePreview();
    });
    for (const request of [
      { ...REQUEST, label: "" },
      { ...REQUEST, executable: "" },
      { ...REQUEST, arguments: "x" },
      { ...REQUEST, environment: { A: 1 } },
      { ...REQUEST, runAtLoad: "no" },
      { ...REQUEST, workingDirectory: 5 },
    ] as unknown as CreateServiceRequest[]) {
      await expect(previewCreateLaunchdService(request)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    expect(called).toBe(false);
  });

  it("does not echo environment values when the backend refuses", async () => {
    mockIPC(() => {
      throw { code: "VALIDATION_FAILED", message: "环境变量名含有不允许的字符。", retryable: false };
    });
    const error = await previewCreateLaunchdService(REQUEST).catch((reason: unknown) => reason);
    expect(JSON.stringify(error)).not.toContain("s3cret-value");
  });

  it("confirms by operation id only and decodes the result", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return wireExecution();
    });

    const execution = await executeCreateLaunchdService("op-1");

    expect(execution.loaded).toBe(false);
    expect(seen).toEqual({
      command: "execute_create_launchd_service",
      payload: { operationId: "op-1" },
    });
  });

  it("rejects an empty operation id without calling the backend", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wireExecution();
    });
    await expect(executeCreateLaunchdService("")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(called).toBe(false);
  });
});
