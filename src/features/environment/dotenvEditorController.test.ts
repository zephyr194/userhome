import { describe, expect, it, vi } from "vitest";
import type { AppError } from "../../ipc/core";
import type { EnvEditPreview, EnvFileView } from "../../ipc/environment";
import type { ResourceWriteExecution, WriteOutcome } from "../../ipc/resources";
import {
  createDotenvEditorController,
  type DotenvEditorDeps,
} from "./dotenvEditorController";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const SECRET_TEXT = "hunter2-very-secret";

const FILE: EnvFileView = {
  relativePath: ".env",
  kind: "ENVIRONMENT",
  contentHash: "a".repeat(64),
  sizeBytes: 30,
  lineCount: 3,
  rows: [
    {
      kind: "ENTRY", line: 1, endLine: 1, key: "PORT", exported: false, secret: false,
      hasValue: true, valueLength: 2, value: "80", quote: "NONE", flags: [],
    },
    {
      kind: "ENTRY", line: 2, endLine: 2, key: "API_TOKEN", exported: false, secret: true,
      hasValue: true, valueLength: 6, quote: "NONE", flags: [],
    },
    {
      kind: "ENTRY", line: 3, endLine: 3, key: "DYN", exported: false, secret: false,
      hasValue: true, valueLength: 5, value: "$HOME", quote: "NONE", flags: ["INTERPOLATION"],
    },
  ],
  rowsTruncated: false,
  entryCount: 3,
  secretCount: 1,
  flaggedCount: 1,
};

const EXISTING = {
  grantId: GRANT_ID,
  path: ".env",
  settings: { patterns: [".env"], recursive: false },
  file: FILE,
};

function previewOf(overrides: Partial<EnvEditPreview> = {}): EnvEditPreview {
  return {
    operationId: "op-1",
    summary: "Replace ~/proj/.env.",
    effects: [],
    expiresAt: "2026-10-16T10:05:00.000Z",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: "~/proj/.env",
    currentHash: "a".repeat(64),
    proposedHash: "b".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    changes: [{ key: "PORT", change: "MODIFY", secret: false, before: "80", after: "81", omitted: false }],
    fileKind: "ENVIRONMENT",
    matchesDefaultPatterns: true,
    ...overrides,
  };
}

function executionOf(outcome: Partial<WriteOutcome> = {}): ResourceWriteExecution {
  return {
    operationId: "op-1",
    summary: "Replace ~/proj/.env.",
    effects: [],
    expiresAt: "2026-10-16T10:05:00.000Z",
    status: "SUCCEEDED",
    events: [],
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      backupId: "backup-1",
      summary: "The file was written and verified.",
      ...outcome,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<DotenvEditorDeps> = {}) {
  const deps = {
    preview: vi.fn<DotenvEditorDeps["preview"]>(() => Promise.resolve(previewOf())),
    execute: vi.fn<DotenvEditorDeps["execute"]>(() => Promise.resolve(executionOf())),
    onSaved: vi.fn(),
    ...overrides,
  };
  const controller = createDotenvEditorController(deps);
  return { controller, deps };
}

function readyToPreview() {
  const harness = setup();
  harness.controller.openExisting(EXISTING);
  harness.controller.setEntryValue("PORT", "81");
  return harness;
}

const error = (code: AppError["code"], message = "后端消息"): AppError => ({
  code,
  message,
  retryable: false,
});

describe("opening and drafting", () => {
  it("starts closed and opens on a file or a new save location", () => {
    const { controller } = setup();
    expect(controller.getState().phase).toBe("closed");
    controller.openExisting(EXISTING);
    expect(controller.getState()).toMatchObject({ phase: "editing", target: { kind: "existing", path: ".env" } });
    controller.close();
    controller.openNew({ grantId: GRANT_ID, displayPath: "~/proj/.env.local" });
    expect(controller.getState()).toMatchObject({ phase: "editing", target: { kind: "new" } });
    expect(controller.check()?.ready).toBe(false);
  });

  it("keeps a draft per key and drops it when switched back", () => {
    const { controller } = setup();
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    expect(controller.getState().entryEdits.PORT).toEqual({ mode: "set", value: "81" });
    controller.setEntryMode("PORT", "remove");
    expect(controller.getState().entryEdits.PORT).toEqual({ mode: "remove", value: "" });
    controller.setEntryMode("PORT", "keep");
    expect(controller.getState().entryEdits).toEqual({});
  });

  it("prefills a plain value but never a secret", () => {
    const { controller } = setup();
    controller.openExisting(EXISTING);
    controller.setEntryMode("PORT", "set");
    controller.setEntryMode("API_TOKEN", "set");
    expect(controller.getState().entryEdits.PORT?.value).toBe("80");
    expect(controller.getState().entryEdits.API_TOKEN?.value).toBe("");
  });

  it("adds, edits and removes new rows with stable ids", () => {
    const { controller } = setup();
    controller.openExisting(EXISTING);
    controller.addRow();
    controller.addRow();
    const [first, second] = controller.getState().additions;
    expect(first?.id).not.toBe(second?.id);
    controller.updateRow(first!.id, { key: "REGION", value: "eu", exported: true });
    controller.removeRow(second!.id);
    expect(controller.getState().additions).toEqual([
      { id: first!.id, key: "REGION", value: "eu", exported: true },
    ]);
    expect(controller.check()?.edits).toEqual([
      { op: "ADD", key: "REGION", value: "eu", exported: true },
    ]);
  });

  it("ignores edits while closed", () => {
    const { controller } = setup();
    controller.setEntryValue("PORT", "1");
    controller.addRow();
    expect(controller.getState().phase).toBe("closed");
    expect(controller.getState().additions).toEqual([]);
  });
});

describe("previewing", () => {
  it("sends nothing until the drafts are ready", async () => {
    const { controller, deps } = setup();
    controller.openExisting(EXISTING);
    await controller.requestPreview();
    expect(deps.preview).not.toHaveBeenCalled();
    controller.setEntryValue("DYN", "x");
    await controller.requestPreview();
    expect(deps.preview).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe("editing");
  });

  it("requests the preview for the target and edits, then waits for confirmation", async () => {
    const { controller, deps } = readyToPreview();
    const pending = controller.requestPreview();
    expect(controller.getState().phase).toBe("previewing");
    await pending;
    expect(deps.preview).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "existing", path: ".env" }),
      [{ op: "SET", key: "PORT", value: "81" }],
    );
    expect(controller.getState()).toMatchObject({ phase: "previewed", preview: { operationId: "op-1" } });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("ignores a second request while one is running", async () => {
    const slow = deferred<EnvEditPreview>();
    const { controller, deps } = setup({ preview: vi.fn(() => slow.promise) });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    const first = controller.requestPreview();
    void controller.requestPreview();
    slow.resolve(previewOf());
    await first;
    expect(deps.preview).toHaveBeenCalledTimes(1);
  });

  it("returns to editing with the drafts and a reason when the preview is refused", async () => {
    const { controller } = setup({
      preview: vi.fn(() => Promise.reject(error("VALIDATION_FAILED", "键 DYN 使用了不改写的写法"))),
    });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    const state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.notice).toMatchObject({ tone: "error", detail: "键 DYN 使用了不改写的写法" });
    expect(state.entryEdits.PORT?.value).toBe("81");
  });

  it("keeps the editor open while a preview is in flight and starts clean when reopened", async () => {
    const slow = deferred<EnvEditPreview>();
    const { controller } = setup({ preview: vi.fn(() => slow.promise) });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    const pending = controller.requestPreview();
    controller.close();
    expect(controller.getState().phase).toBe("previewing");
    slow.resolve(previewOf());
    await pending;
    expect(controller.getState().phase).toBe("previewed");

    controller.cancelPreview();
    controller.close();
    controller.openNew({ grantId: GRANT_ID, displayPath: "~/x/.env" });
    expect(controller.getState().preview).toBeUndefined();
  });

  it("can go back from a preview to the drafts", async () => {
    const { controller } = readyToPreview();
    await controller.requestPreview();
    controller.cancelPreview();
    expect(controller.getState()).toMatchObject({ phase: "editing", preview: undefined });
    expect(controller.getState().entryEdits.PORT?.value).toBe("81");
  });
});

describe("confirming", () => {
  it("writes only after the confirmation and reports the verified result", async () => {
    const { controller, deps } = readyToPreview();
    await controller.requestPreview();
    const pending = controller.confirm();
    expect(controller.getState().phase).toBe("saving");
    await pending;
    expect(deps.execute).toHaveBeenCalledWith(expect.objectContaining({ path: ".env" }), "op-1");
    expect(controller.getState()).toMatchObject({
      phase: "saved",
      result: { status: "SUCCEEDED", fileState: "WRITTEN", recoveryPoint: "BACKUP", backupId: "backup-1" },
    });
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
  });

  it("clears the drafts, so secret text does not outlive the save", async () => {
    const { controller } = setup();
    controller.openExisting(EXISTING);
    controller.setEntryValue("API_TOKEN", SECRET_TEXT);
    controller.addRow();
    controller.updateRow(controller.getState().additions[0]!.id, { key: "NEW_PASSWORD", value: SECRET_TEXT });
    await controller.requestPreview();
    await controller.confirm();
    const state = controller.getState();
    expect(state.entryEdits).toEqual({});
    expect(state.additions).toEqual([]);
    expect(JSON.stringify(state)).not.toContain(SECRET_TEXT);
  });

  it("confirms at most once", async () => {
    const slow = deferred<ResourceWriteExecution>();
    const { controller, deps } = setup({ execute: vi.fn(() => slow.promise) });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    const first = controller.confirm();
    void controller.confirm();
    slow.resolve(executionOf());
    await first;
    expect(deps.execute).toHaveBeenCalledTimes(1);
    await controller.confirm();
    expect(deps.execute).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a preview", async () => {
    const { controller, deps } = setup();
    controller.openExisting(EXISTING);
    await controller.confirm();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("reports a failed transaction as it is and lets a safe state resume editing", async () => {
    const { controller, deps } = setup({
      execute: vi.fn(() =>
        Promise.resolve(
          executionOf({ status: "FAILED", fileState: "RESTORED", error: error("VALIDATION_FAILED", "读回校验未通过") }),
        ),
      ),
    });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    await controller.confirm();
    expect(controller.getState()).toMatchObject({
      phase: "saved",
      result: { status: "FAILED", fileState: "RESTORED", errorMessage: "读回校验未通过" },
    });
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    expect(controller.getState().entryEdits.PORT?.value).toBe("81");
    controller.resumeEditing();
    expect(controller.getState().phase).toBe("editing");
  });

  it("does not offer to resume when the file state is uncertain", async () => {
    for (const fileState of ["RESTORE_FAILED", "UNKNOWN", "CREATED_REMOVE_FAILED"] as const) {
      const { controller } = setup({
        execute: vi.fn(() => Promise.resolve(executionOf({ status: "FAILED", fileState }))),
      });
      controller.openExisting(EXISTING);
      controller.setEntryValue("PORT", "81");
      await controller.requestPreview();
      await controller.confirm();
      controller.resumeEditing();
      expect(controller.getState().phase, fileState).toBe("saved");
    }
  });

  it.each([
    ["TIMEOUT", /过期/],
    ["CONFLICT", /已变化/],
    ["PERMISSION_DENIED", /权限|授权/],
  ] as const)("returns to editing with a notice when the confirmation is refused (%s)", async (code, text) => {
    const { controller, deps } = setup({
      execute: vi.fn(() => Promise.reject(error(code))),
    });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    await controller.confirm();
    const state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.notice?.text).toMatch(text);
    expect(state.preview).toBeUndefined();
    expect(state.entryEdits.PORT?.value).toBe("81");
    expect(deps.onSaved).not.toHaveBeenCalled();
  });

  it("treats an unexpected rejection as unconfirmed, never as success", async () => {
    const { controller } = setup({ execute: vi.fn(() => Promise.reject(new Error("boom"))) });
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    await controller.confirm();
    expect(controller.getState().phase).toBe("editing");
    expect(controller.getState().notice?.tone).toBe("error");
  });
});

describe("expiry and closing", () => {
  it("expires a preview on the client at its deadline", async () => {
    const { controller } = readyToPreview();
    await controller.requestPreview();
    const deadline = Date.parse("2026-10-16T10:05:00.000Z");
    controller.checkExpiry(deadline - 1);
    expect(controller.getState().phase).toBe("previewed");
    controller.checkExpiry(deadline);
    expect(controller.getState()).toMatchObject({ phase: "editing", preview: undefined });
    expect(controller.getState().notice?.text).toMatch(/过期/);
  });

  it("closes only when nothing is in flight and discards every draft", async () => {
    const slow = deferred<ResourceWriteExecution>();
    const { controller } = setup({ execute: vi.fn(() => slow.promise) });
    controller.openExisting(EXISTING);
    controller.setEntryValue("API_TOKEN", SECRET_TEXT);
    await controller.requestPreview();
    const pending = controller.confirm();
    controller.close();
    expect(controller.getState().phase).toBe("saving");
    slow.resolve(executionOf());
    await pending;
    controller.close();
    expect(controller.getState()).toMatchObject({ phase: "closed", entryEdits: {}, additions: [] });
    expect(JSON.stringify(controller.getState())).not.toContain(SECRET_TEXT);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.openExisting(EXISTING);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.setEntryValue("PORT", "81");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls the latest saved-callback and none after it is cleared", async () => {
    const { controller, deps } = setup();
    const later = vi.fn();
    controller.setOnSaved(later);
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "81");
    await controller.requestPreview();
    await controller.confirm();
    expect(later).toHaveBeenCalledTimes(1);
    expect(deps.onSaved).not.toHaveBeenCalled();

    controller.close();
    controller.setOnSaved(undefined);
    controller.openExisting(EXISTING);
    controller.setEntryValue("PORT", "82");
    await controller.requestPreview();
    await controller.confirm();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
