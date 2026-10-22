import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  executeResourceWrite,
  getResourceWriteBatch,
  previewResourceWrites,
} from "./resources";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: "Replace ~/project/settings.toml.",
    effects: ["Target: ~/project/settings.toml"],
    expiresAt: "2026-10-15T10:05:00Z",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: "~/project/settings.toml",
    currentHash: HASH_A,
    proposedHash: HASH_B,
    diff: {
      lines: [
        { kind: "REMOVED", text: "x = 1" },
        { kind: "ADDED", text: "x = 2" },
      ],
      redacted: false,
      truncated: false,
    },
    ...overrides,
  };
}

function wireBatch(overrides: Record<string, unknown> = {}) {
  return {
    batchId: "batch-1",
    atomic: false,
    note: "Files are written one at a time, in order. A batch is not an atomic transaction.",
    steps: [wirePreview()],
    ...overrides,
  };
}

function wireOutcome(overrides: Record<string, unknown> = {}) {
  return {
    kind: "REPLACE",
    status: "SUCCEEDED",
    fileState: "WRITTEN",
    recoveryPoint: "BACKUP",
    backupId: "backup-1-abc",
    summary: "The file was written and verified.",
    ...overrides,
  };
}

function wireExecution(outcome: Record<string, unknown> = wireOutcome()) {
  const { operationId, summary, effects, expiresAt } =
    wirePreview();
  return {
    operationId,
    summary,
    effects,
    expiresAt,
    status: "SUCCEEDED",
    events: [],
    outcome,
  };
}

afterEach(() => {
  clearMocks();
});

describe("resource write IPC", () => {
  it("previews writes by authorization id and relative path only", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_resource_writes");
      expect(payload).toEqual({
        input: {
          writes: [
            {
              grantId: GRANT_ID,
              relativePath: "settings.toml",
              expectedHash: HASH_A,
              content: "x = 2\n",
            },
            { grantId: GRANT_ID, relativePath: "new.toml", content: "y = 1\n", sensitive: true },
          ],
        },
      });
      return wireBatch({
        steps: [
          wirePreview(),
          wirePreview({
            operationId: "op-2",
            kind: "CREATE",
            recoveryPoint: "NONE_CREATED",
            currentHash: undefined,
            target: "~/project/new.toml",
          }),
        ],
      });
    });

    const batch = await previewResourceWrites([
      { grantId: GRANT_ID, relativePath: "settings.toml", expectedHash: HASH_A, content: "x = 2\n" },
      { grantId: GRANT_ID, relativePath: "new.toml", content: "y = 1\n", sensitive: true },
    ]);

    expect(batch.atomic).toBe(false);
    expect(batch.steps.map((step) => step.kind)).toEqual(["REPLACE", "CREATE"]);
    expect(batch.steps[1].recoveryPoint).toBe("NONE_CREATED");
    expect(batch.steps[1].currentHash).toBeUndefined();
    expect(batch.steps[0].diff.lines).toHaveLength(2);
  });

  it.each([
    ["an absolute path", { relativePath: "/etc/hosts" }],
    ["a parent segment", { relativePath: "../outside.toml" }],
    ["a nested parent segment", { relativePath: "a/../../b.toml" }],
    ["a backslash path", { relativePath: "a\\b.toml" }],
    ["an empty path", { relativePath: "" }],
    ["a control character", { relativePath: "a\nb" }],
    ["a malformed grant id", { grantId: "/Users/someone/.ssh" }],
    ["a malformed hash", { expectedHash: "not-a-hash" }],
  ])("refuses to send %s", async (_label, override) => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wireBatch();
    });

    await expect(
      previewResourceWrites([
        { grantId: GRANT_ID, relativePath: "a.toml", content: "x\n", ...override },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(called).toBe(false);
  });

  it("refuses empty and oversized batches before calling the backend", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wireBatch();
    });
    const write = { grantId: GRANT_ID, relativePath: "a.toml", content: "x\n" };

    await expect(previewResourceWrites([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      previewResourceWrites(Array.from({ length: 17 }, () => write)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(called).toBe(false);
  });

  it.each([
    ["an atomic claim", wireBatch({ atomic: true })],
    ["a missing note", wireBatch({ note: undefined })],
    ["no steps", wireBatch({ steps: [] })],
    ["a create with a backup point", wireBatch({ steps: [wirePreview({ kind: "CREATE", currentHash: undefined })] })],
    ["a replace without a read hash", wireBatch({ steps: [wirePreview({ currentHash: undefined })] })],
    ["a malformed proposed hash", wireBatch({ steps: [wirePreview({ proposedHash: "zz" })] })],
    ["an unknown kind", wireBatch({ steps: [wirePreview({ kind: "DELETE" })] })],
    ["a malformed diff", wireBatch({ steps: [wirePreview({ diff: { lines: [{ kind: "X", text: "" }], redacted: false, truncated: false } })] })],
  ])("rejects %s in a preview response", async (_label, response) => {
    mockIPC(() => response);

    await expect(
      previewResourceWrites([
        { grantId: GRANT_ID, relativePath: "a.toml", expectedHash: HASH_A, content: "x\n" },
      ]),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("confirms a step with the operation, authorization and relative path", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_resource_write");
      expect(payload).toEqual({
        input: { operationId: "op-1", grantId: GRANT_ID, relativePath: "settings.toml" },
      });
      return wireExecution();
    });

    const execution = await executeResourceWrite({
      operationId: "op-1",
      grantId: GRANT_ID,
      relativePath: "settings.toml",
    });

    expect(execution.outcome).toEqual(wireOutcome());
    expect(execution.status).toBe("SUCCEEDED");
  });

  it("refuses to confirm with an absolute path or a malformed id", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return wireExecution();
    });

    await expect(
      executeResourceWrite({ operationId: "op-1", grantId: GRANT_ID, relativePath: "/etc/hosts" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      executeResourceWrite({ operationId: "op-1", grantId: "../x" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      executeResourceWrite({ operationId: "", grantId: GRANT_ID }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(called).toBe(false);
  });

  it("reports a restore result and a failed restore as they are", async () => {
    mockIPC(() =>
      wireExecution(
        wireOutcome({
          status: "FAILED",
          fileState: "RESTORE_FAILED",
          summary: "The previous content could not be confirmed as restored.",
          error: { code: "PARTIAL_FAILURE", message: "Restore did not complete.", retryable: false },
        }),
      ),
    );

    const execution = await executeResourceWrite({
      operationId: "op-1",
      grantId: GRANT_ID,
      relativePath: "settings.toml",
    });

    expect(execution.outcome.status).toBe("FAILED");
    expect(execution.outcome.fileState).toBe("RESTORE_FAILED");
    expect(execution.outcome.backupId).toBe("backup-1-abc");
    expect(execution.outcome.error?.code).toBe("PARTIAL_FAILURE");
  });

  it("keeps a creation marked as created with no recovery point", async () => {
    mockIPC(() =>
      wireExecution(
        wireOutcome({
          kind: "CREATE",
          recoveryPoint: "NONE_CREATED",
          backupId: undefined,
          summary: "The file was created and verified. It is new, so there is no recovery point.",
        }),
      ),
    );

    const execution = await executeResourceWrite({
      operationId: "op-1",
      grantId: GRANT_ID,
      relativePath: "new.toml",
    });

    expect(execution.outcome.kind).toBe("CREATE");
    expect(execution.outcome.recoveryPoint).toBe("NONE_CREATED");
    expect(execution.outcome.backupId).toBeUndefined();
  });

  it.each([
    ["a fabricated backup for a creation", wireOutcome({ kind: "CREATE", recoveryPoint: "NONE_CREATED", backupId: "backup-1-abc" })],
    ["a creation pointing at a backup", wireOutcome({ kind: "CREATE" })],
    ["a backup point without an id", wireOutcome({ backupId: undefined })],
    ["a success that is not written", wireOutcome({ fileState: "RESTORED" })],
    ["an unknown file state", wireOutcome({ fileState: "FINE" })],
  ])("rejects %s in an execution response", async (_label, outcome) => {
    mockIPC(() => wireExecution(outcome));

    await expect(
      executeResourceWrite({ operationId: "op-1", grantId: GRANT_ID, relativePath: "a.toml" }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("decodes backend refusals without leaking extra fields", async () => {
    mockIPC(() => {
      throw {
        code: "CONFLICT",
        message: "The resource changed after the preview was created; re-read it and preview again.",
        retryable: false,
        path: "/Users/someone/secret",
      };
    });

    await expect(
      executeResourceWrite({ operationId: "op-1", grantId: GRANT_ID, relativePath: "a.toml" }),
    ).rejects.toEqual({
      code: "CONFLICT",
      message: "The resource changed after the preview was created; re-read it and preview again.",
      retryable: false,
    });
  });

  it("decodes batch progress and keeps completed steps", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("get_resource_write_batch");
      expect(payload).toEqual({ batchId: "batch-1" });
      return {
        batchId: "batch-1",
        atomic: false,
        note: "Files are written one at a time, in order. A batch is not an atomic transaction.",
        completed: 1,
        total: 3,
        steps: [
          { index: 0, operationId: "op-1", target: "~/p/one.toml", kind: "REPLACE", state: "SUCCEEDED", outcome: wireOutcome() },
          {
            index: 1,
            operationId: "op-2",
            target: "~/p/two.toml",
            kind: "REPLACE",
            state: "REJECTED",
            error: { code: "CONFLICT", message: "Changed; preview again.", retryable: false },
          },
          { index: 2, operationId: "op-3", target: "~/p/three.toml", kind: "REPLACE", state: "BLOCKED" },
        ],
      };
    });

    const status = await getResourceWriteBatch("batch-1");

    expect(status.atomic).toBe(false);
    expect(status.completed).toBe(1);
    expect(status.steps.map((step) => step.state)).toEqual(["SUCCEEDED", "REJECTED", "BLOCKED"]);
    expect(status.steps[0].outcome?.backupId).toBe("backup-1-abc");
    expect(status.steps[1].error?.code).toBe("CONFLICT");
  });

  it("rejects a completed count that the steps do not back up", async () => {
    mockIPC(() => ({
      batchId: "batch-1",
      atomic: false,
      note: "Not atomic.",
      completed: 2,
      total: 1,
      steps: [{ index: 0, operationId: "op-1", target: "~/p/one.toml", kind: "REPLACE", state: "FAILED" }],
    }));

    await expect(getResourceWriteBatch("batch-1")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
