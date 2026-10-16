import { describe, expect, it, vi } from "vitest";
import type { AppError } from "../../ipc/core";
import type { ZshEditOutcome } from "../../ipc/environment";
import {
  createZshEditorController,
  type ZshEditorDeps,
} from "./zshEditorController";
import {
  GRANT_ID,
  HASH,
  SECRET_TEXT,
  emptyStateOf,
  executionOf,
  previewOf,
  readyOutcome,
  stateOf,
} from "./zshEditorFixtures";

const TARGET = { file: "ZSHRC" } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<ZshEditorDeps> = {}) {
  const deps = {
    load: vi.fn<ZshEditorDeps["load"]>(() => Promise.resolve(readyOutcome())),
    enable: vi.fn<ZshEditorDeps["enable"]>(() =>
      Promise.resolve({
        file: "ZSHRC" as const,
        displayPath: "~/.zshrc",
        fullPath: "/Users/me/.zshrc",
        exists: true,
        grantId: GRANT_ID,
      }),
    ),
    revoke: vi.fn<ZshEditorDeps["revoke"]>(() => Promise.resolve()),
    preview: vi.fn<ZshEditorDeps["preview"]>(() => Promise.resolve(previewOf())),
    execute: vi.fn<ZshEditorDeps["execute"]>(() => Promise.resolve(executionOf())),
    onSaved: vi.fn(),
    ...overrides,
  };
  const controller = createZshEditorController(deps);
  return { controller, deps };
}

async function opened(overrides: Partial<ZshEditorDeps> = {}) {
  const harness = setup(overrides);
  await harness.controller.open(TARGET);
  return harness;
}

async function readyToPreview(overrides: Partial<ZshEditorDeps> = {}) {
  const harness = await opened(overrides);
  harness.controller.setVariableValue("EDITOR", "nvim");
  return harness;
}

function appError(code: AppError["code"], message = "后端说明"): AppError {
  return { code, message, retryable: false };
}

describe("opening", () => {
  it("loads the file and starts the PATH drafts from the block", async () => {
    const { controller, deps } = await opened();
    const state = controller.getState();
    expect(deps.load).toHaveBeenCalledWith(TARGET);
    expect(state.phase).toBe("editing");
    expect(state.loaded?.file).toBe("ZSHRC");
    expect(state.problem).toBeUndefined();
    expect(state.drafts.path.map((item) => item.text)).toEqual(["/opt/tool/bin", "$HOME/bin"]);
    expect(controller.check()?.ready).toBe(false);
  });

  it("passes the chosen ZDOTDIR directory on and shows a loading phase", async () => {
    const gate = deferred<ZshEditOutcome>();
    const { controller, deps } = setup({ load: vi.fn(() => gate.promise) });
    const target = { file: "ZPROFILE", zdotdirGrantId: GRANT_ID } as const;
    const pending = controller.open(target);
    expect(controller.getState().phase).toBe("loading");
    expect(controller.check()).toBeUndefined();
    gate.resolve(readyOutcome(stateOf({ file: "ZPROFILE", name: ".zprofile" })));
    await pending;
    expect(deps.load).toHaveBeenCalledWith(target);
    expect(controller.getState().phase).toBe("editing");
  });

  it("keeps outcomes that are not ready as a problem, with nothing to edit", async () => {
    for (const outcome of [
      { status: "OUTSIDE_HOME", message: "越界" },
      { status: "NOT_LOCATED", message: "未确定" },
      { status: "UNAVAILABLE", reason: "IO", message: "读取出错" },
    ] as const) {
      const { controller } = await opened({ load: vi.fn(() => Promise.resolve(outcome)) });
      const state = controller.getState();
      expect(state.phase).toBe("editing");
      expect(state.loaded).toBeUndefined();
      expect(state.problem).toEqual({ kind: outcome.status, message: outcome.message });
      expect(controller.check()).toBeUndefined();
      controller.addVariable();
      expect(controller.getState().drafts.additions).toEqual([]);
      void controller.requestPreview();
      expect(controller.getState().phase).toBe("editing");
    }
  });

  it("turns a failed read into a problem and never throws", async () => {
    const { controller } = await opened({
      load: vi.fn(() => Promise.reject(appError("PERMISSION_DENIED", "没有权限"))),
    });
    expect(controller.getState().problem).toEqual({ kind: "ERROR", message: "没有权限" });
    expect(controller.getState().loaded).toBeUndefined();
  });

  it("ignores a second open while one is loading and lets close drop the state", async () => {
    const gate = deferred<ZshEditOutcome>();
    const { controller, deps } = setup({ load: vi.fn(() => gate.promise) });
    const first = controller.open(TARGET);
    await controller.open({ file: "ZSHENV" });
    expect(deps.load).toHaveBeenCalledTimes(1);
    controller.close();
    expect(controller.getState().phase).toBe("loading");
    gate.resolve(readyOutcome());
    await first;
    controller.close();
    expect(controller.getState().phase).toBe("closed");
    expect(controller.getState().loaded).toBeUndefined();
  });
});

describe("enabling and disabling editing", () => {
  const notEnabled = () => readyOutcome(stateOf({ enabled: false, grantId: undefined }));

  it("enables editing, re-reads and keeps the drafts when the file did not change", async () => {
    const load = vi
      .fn<ZshEditorDeps["load"]>()
      .mockResolvedValueOnce(notEnabled())
      .mockResolvedValueOnce(readyOutcome());
    const { controller, deps } = await opened({ load });
    controller.setVariableValue("EDITOR", "nvim");
    await controller.enable();
    expect(deps.enable).toHaveBeenCalledWith(TARGET);
    expect(load).toHaveBeenCalledTimes(2);
    const state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.loaded?.enabled).toBe(true);
    expect(state.drafts.variables.EDITOR?.value).toBe("nvim");
    expect(state.notice).toBeUndefined();
  });

  it("drops the drafts and says so when the file changed in between", async () => {
    const load = vi
      .fn<ZshEditorDeps["load"]>()
      .mockResolvedValueOnce(notEnabled())
      .mockResolvedValueOnce(readyOutcome(stateOf({ contentHash: "c".repeat(64) })));
    const { controller } = await opened({ load });
    controller.setVariableValue("EDITOR", "nvim");
    await controller.enable();
    const state = controller.getState();
    expect(state.drafts.variables).toEqual({});
    expect(state.notice?.text).toContain("已重新读取并放弃未保存的改动");
  });

  it("reports a refusal and stays where it was; enabling twice does nothing", async () => {
    const { controller, deps } = await opened({
      load: vi.fn(() => Promise.resolve(notEnabled())),
      enable: vi.fn(() => Promise.reject(appError("PERMISSION_DENIED", "在主目录之外"))),
    });
    await controller.enable();
    expect(controller.getState().phase).toBe("editing");
    expect(controller.getState().loaded?.enabled).toBe(false);
    expect(controller.getState().notice).toMatchObject({ tone: "error", detail: "在主目录之外" });
    const enabled = await opened();
    await enabled.controller.enable();
    expect(enabled.deps.enable).not.toHaveBeenCalled();
    void deps;
  });

  it("revokes the authorization and re-reads", async () => {
    const load = vi
      .fn<ZshEditorDeps["load"]>()
      .mockResolvedValueOnce(readyOutcome())
      .mockResolvedValueOnce(notEnabled());
    const { controller, deps } = await opened({ load });
    await controller.disable();
    expect(deps.revoke).toHaveBeenCalledWith(GRANT_ID);
    expect(controller.getState().loaded?.enabled).toBe(false);
    const idle = await opened({ load: vi.fn(() => Promise.resolve(notEnabled())) });
    await idle.controller.disable();
    expect(idle.deps.revoke).not.toHaveBeenCalled();
  });

  it("keeps the authorization when revoking fails", async () => {
    const { controller } = await opened({
      revoke: vi.fn(() => Promise.reject(appError("NOT_FOUND", "已不存在"))),
    });
    await controller.disable();
    expect(controller.getState().phase).toBe("editing");
    expect(controller.getState().loaded?.enabled).toBe(true);
    expect(controller.getState().notice?.tone).toBe("error");
  });
});

describe("variable drafts", () => {
  it("prefills non-secret values, never secrets, and can undo", async () => {
    const { controller } = await opened();
    controller.setVariableMode("EDITOR", "set");
    expect(controller.getState().drafts.variables.EDITOR).toEqual({ mode: "set", value: "vim" });
    controller.setVariableMode("API_TOKEN", "set");
    expect(controller.getState().drafts.variables.API_TOKEN).toEqual({ mode: "set", value: "" });
    controller.setVariableMode("EDITOR", "remove");
    expect(controller.getState().drafts.variables.EDITOR).toEqual({ mode: "remove", value: "" });
    controller.setVariableMode("EDITOR", "keep");
    expect(controller.getState().drafts.variables.EDITOR).toBeUndefined();
    controller.setVariableValue("API_TOKEN", SECRET_TEXT);
    expect(controller.check()?.edit?.variables).toEqual([
      { op: "SET", name: "API_TOKEN", value: SECRET_TEXT },
    ]);
  });

  it("adds, edits and removes new variable rows with stable ids", async () => {
    const { controller } = await opened();
    controller.addVariable();
    controller.addVariable();
    const [first, second] = controller.getState().drafts.additions;
    if (first === undefined || second === undefined) throw new Error("rows");
    expect(first.id).not.toBe(second.id);
    controller.updateVariable(first.id, { name: "GOPATH", value: "/Users/me/go" });
    controller.removeVariable(second.id);
    expect(controller.getState().drafts.additions).toEqual([
      { id: first.id, name: "GOPATH", value: "/Users/me/go" },
    ]);
    expect(controller.check()?.edit?.variables).toEqual([
      { op: "SET", name: "GOPATH", value: "/Users/me/go" },
    ]);
  });
});

describe("PATH drafts", () => {
  async function pathOf(controller: ReturnType<typeof setup>["controller"]) {
    return controller.getState().drafts.path.map((item) => item.text);
  }

  it("adds, edits and removes items", async () => {
    const { controller } = await opened();
    controller.addPathItem();
    const added = controller.getState().drafts.path[controller.getState().drafts.path.length - 1];
    if (added === undefined) throw new Error("item");
    expect(added.text).toBe("");
    expect(controller.check()?.problems.path[added.id]).toBeDefined();
    controller.updatePathItem(added.id, "~/.cargo/bin");
    expect(controller.check()?.edit).toEqual({
      variables: [],
      path: ["/opt/tool/bin", "$HOME/bin", "$HOME/.cargo/bin"],
    });
    const first = controller.getState().drafts.path[0];
    if (first === undefined) throw new Error("first");
    controller.removePathItem(first.id);
    expect(await pathOf(controller)).toEqual(["$HOME/bin", "~/.cargo/bin"]);
  });

  it("moves an item one place up or down by id and stops at the ends", async () => {
    const { controller } = await opened();
    controller.addPathItem();
    const items = controller.getState().drafts.path;
    const third = items[2];
    const first = items[0];
    if (third === undefined || first === undefined) throw new Error("items");
    controller.updatePathItem(third.id, "/c");
    controller.movePathItem(third.id, -1);
    expect(await pathOf(controller)).toEqual(["/opt/tool/bin", "/c", "$HOME/bin"]);
    controller.movePathItem(third.id, -1);
    controller.movePathItem(third.id, -1);
    expect(await pathOf(controller)).toEqual(["/c", "/opt/tool/bin", "$HOME/bin"]);
    controller.movePathItem(first.id, 1);
    expect(await pathOf(controller)).toEqual(["/c", "$HOME/bin", "/opt/tool/bin"]);
    controller.movePathItem(first.id, 1);
    expect(await pathOf(controller)).toEqual(["/c", "$HOME/bin", "/opt/tool/bin"]);
    controller.movePathItem(9999, 1);
    expect(await pathOf(controller)).toEqual(["/c", "$HOME/bin", "/opt/tool/bin"]);
    expect(controller.check()?.pathChanged).toBe(true);
    expect(controller.check()?.edit?.path).toEqual(["/c", "$HOME/bin", "/opt/tool/bin"]);
  });

  it("takes no edits while a request is in flight or nothing is loaded", async () => {
    const gate = deferred<ReturnType<typeof previewOf>>();
    const { controller } = await readyToPreview({ preview: vi.fn(() => gate.promise) });
    const pending = controller.requestPreview();
    expect(controller.getState().phase).toBe("previewing");
    controller.addPathItem();
    controller.addVariable();
    controller.setVariableValue("EDITOR", "other");
    const first = controller.getState().drafts.path[0];
    if (first !== undefined) controller.movePathItem(first.id, 1);
    expect(controller.getState().drafts.path).toHaveLength(2);
    expect(controller.getState().drafts.additions).toHaveLength(0);
    expect(controller.getState().drafts.variables.EDITOR?.value).toBe("nvim");
    gate.resolve(previewOf());
    await pending;
  });
});

describe("previewing", () => {
  it("sends the edit with the hash it read and shows the preview", async () => {
    const { controller, deps } = await readyToPreview();
    await controller.requestPreview();
    expect(deps.preview).toHaveBeenCalledWith(
      TARGET,
      HASH,
      { variables: [{ op: "SET", name: "EDITOR", value: "nvim" }] },
    );
    expect(controller.getState().phase).toBe("previewed");
    expect(controller.getState().preview?.operationId).toBe("op-1");
  });

  it("previews a file that does not exist yet without a hash", async () => {
    const missing = emptyStateOf({ exists: false, contentHash: undefined, enabled: true });
    const { controller, deps } = await opened({
      load: vi.fn(() => Promise.resolve(readyOutcome(missing))),
    });
    controller.addVariable();
    const row = controller.getState().drafts.additions[0];
    if (row === undefined) throw new Error("row");
    controller.updateVariable(row.id, { name: "EDITOR", value: "vim" });
    await controller.requestPreview();
    expect(deps.preview).toHaveBeenCalledWith(TARGET, undefined, {
      variables: [{ op: "SET", name: "EDITOR", value: "vim" }],
    });
  });

  it("sends nothing while a draft is wrong or nothing changed", async () => {
    const { controller, deps } = await opened();
    await controller.requestPreview();
    controller.setVariableValue("EDITOR", "a\nb");
    await controller.requestPreview();
    expect(deps.preview).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe("editing");
  });

  it("maps a refusal to a notice, keeps the drafts and is left editable", async () => {
    const { controller } = await readyToPreview({
      preview: vi.fn(() => Promise.reject(appError("CONFLICT", "文件已变化"))),
    });
    await controller.requestPreview();
    const state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.notice).toMatchObject({ tone: "error", detail: "文件已变化" });
    expect(state.notice?.text).toContain("没有写入任何内容");
    expect(state.drafts.variables.EDITOR?.value).toBe("nvim");
  });

  it("cancelling returns to editing, and a late answer never replaces that", async () => {
    const gate = deferred<ReturnType<typeof previewOf>>();
    const { controller } = await readyToPreview({ preview: vi.fn(() => gate.promise) });
    const pending = controller.requestPreview();
    controller.cancelPreview();
    expect(controller.getState().phase).toBe("previewing");
    gate.resolve(previewOf());
    await pending;
    expect(controller.getState().phase).toBe("previewed");
    controller.cancelPreview();
    expect(controller.getState().phase).toBe("editing");
    expect(controller.getState().preview).toBeUndefined();
  });

  it("drops a preview whose deadline has passed", async () => {
    const { controller } = await readyToPreview();
    await controller.requestPreview();
    const deadline = Date.parse("2026-10-16T10:05:00.000Z");
    controller.checkExpiry(deadline - 1);
    expect(controller.getState().phase).toBe("previewed");
    controller.checkExpiry(deadline);
    expect(controller.getState().phase).toBe("editing");
    expect(controller.getState().notice?.text).toContain("预览已过期");
    expect(controller.getState().preview).toBeUndefined();
  });
});

describe("confirming", () => {
  it("executes the previewed operation, drops the drafts and tells the page", async () => {
    const { controller, deps } = await opened();
    controller.setVariableValue("API_TOKEN", SECRET_TEXT);
    await controller.requestPreview();
    await controller.confirm();
    expect(deps.execute).toHaveBeenCalledWith(TARGET, "op-1");
    const state = controller.getState();
    expect(state.phase).toBe("saved");
    expect(state.result).toMatchObject({ status: "SUCCEEDED", fileState: "WRITTEN", backupId: "backup-1" });
    expect(state.drafts.variables).toEqual({});
    expect(JSON.stringify(state)).not.toContain(SECRET_TEXT);
    expect(deps.onSaved).toHaveBeenCalledWith(TARGET);
    controller.close();
    expect(controller.getState().phase).toBe("closed");
  });

  it("is only possible from a shown preview and runs once", async () => {
    const { controller, deps } = await readyToPreview();
    await controller.confirm();
    expect(deps.execute).not.toHaveBeenCalled();
    await controller.requestPreview();
    await Promise.all([controller.confirm(), controller.confirm()]);
    expect(deps.execute).toHaveBeenCalledTimes(1);
  });

  it("reports a failed transaction faithfully and keeps the drafts to resume", async () => {
    const failed = executionOf({
      status: "FAILED",
      fileState: "RESTORED",
      error: appError("VALIDATION_FAILED", "读回校验未通过"),
    });
    const { controller, deps } = await readyToPreview({
      execute: vi.fn(() => Promise.resolve(failed)),
    });
    await controller.requestPreview();
    await controller.confirm();
    let state = controller.getState();
    expect(state.phase).toBe("saved");
    expect(state.result).toMatchObject({
      status: "FAILED",
      fileState: "RESTORED",
      errorMessage: "读回校验未通过",
    });
    expect(state.drafts.variables.EDITOR?.value).toBe("nvim");
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    controller.resumeEditing();
    state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.result).toBeUndefined();
  });

  it("cannot resume when the file may contain the new content", async () => {
    const { controller } = await readyToPreview({
      execute: vi.fn(() => Promise.resolve(executionOf({ status: "FAILED", fileState: "RESTORE_FAILED" }))),
    });
    await controller.requestPreview();
    await controller.confirm();
    controller.resumeEditing();
    expect(controller.getState().phase).toBe("saved");
  });

  it("returns to editing with a notice when the confirmation is refused", async () => {
    const { controller, deps } = await readyToPreview({
      execute: vi.fn(() => Promise.reject(appError("TIMEOUT", "预览过期"))),
    });
    await controller.requestPreview();
    await controller.confirm();
    const state = controller.getState();
    expect(state.phase).toBe("editing");
    expect(state.preview).toBeUndefined();
    expect(state.notice?.text).toContain("预览已过期");
    expect(state.drafts.variables.EDITOR?.value).toBe("nvim");
    expect(deps.onSaved).not.toHaveBeenCalled();
  });

  it("cannot be closed or reopened while saving", async () => {
    const gate = deferred<ReturnType<typeof executionOf>>();
    const { controller } = await readyToPreview({ execute: vi.fn(() => gate.promise) });
    await controller.requestPreview();
    const pending = controller.confirm();
    expect(controller.getState().phase).toBe("saving");
    controller.close();
    await controller.open({ file: "ZSHENV" });
    expect(controller.getState().phase).toBe("saving");
    gate.resolve(executionOf());
    await pending;
    expect(controller.getState().phase).toBe("saved");
  });
});

describe("reloading and subscriptions", () => {
  it("re-reads the file and drops the drafts", async () => {
    const { controller, deps } = await readyToPreview();
    await controller.reload();
    expect(deps.load).toHaveBeenCalledTimes(2);
    expect(controller.getState().drafts.variables).toEqual({});
  });

  it("tells subscribers about every change and stops after unsubscribe", async () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    await controller.open(TARGET);
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    unsubscribe();
    controller.addVariable();
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("lets the page replace the saved callback", async () => {
    const { controller, deps } = await readyToPreview();
    const replacement = vi.fn();
    controller.setOnSaved(replacement);
    await controller.requestPreview();
    await controller.confirm();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
});
