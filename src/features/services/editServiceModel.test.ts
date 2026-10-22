import { describe, expect, it } from "vitest";
import type { EditExecution, EditPreview } from "../../ipc/servicesAdopt";
import type { AppError } from "../../ipc/core";
import type { LaunchdKeepAlive, LaunchdPlistDetails } from "../../ipc/services";
import { configFile, launchdService } from "./launchdFixtures";
import {
  KEEP_ALIVE_CONDITIONAL_NOTE,
  INITIAL_EDIT_DIALOG,
  buildEditRequest,
  discardTarget,
  describeEditOutcome,
  editDialogReducer,
  editOriginalOf,
  grantNotice,
  initialEditForm,
  toggleEnvironmentRemoval,
  wasSaved,
  type EditDialogState,
  type EditFormState,
  type EditOriginal,
} from "./editServiceModel";
import { addEnvironment, updateEnvironmentKey, updateEnvironmentValue } from "./createServiceModel";

const LABEL = "com.vendor.backup";

function plistDetails(overrides: Partial<LaunchdPlistDetails> = {}): LaunchdPlistDetails {
  return {
    programArguments: ["/usr/local/bin/tool", "--serve", "--port=8080"],
    argumentsTruncated: false,
    environmentKeys: ["API_TOKEN", "MODE"],
    runAtLoad: false,
    keepAlive: { mode: "NEVER", conditions: [] },
    standardOutPath: "~/Library/Logs/out.log",
    ...overrides,
  };
}

function originalFile(keepAlive: LaunchdKeepAlive = { mode: "NEVER", conditions: [] }) {
  return configFile({ details: plistDetails({ keepAlive }) });
}

function original(overrides: Partial<EditOriginal> = {}): EditOriginal {
  return {
    ...editOriginalOf(launchdService({ label: LABEL, configFiles: [originalFile()] })),
    ...overrides,
  };
}

function formOf(overrides: Partial<EditFormState> = {}, base = original()): EditFormState {
  return { ...initialEditForm(base), ...overrides };
}

function preview(): EditPreview {
  return {
    operationId: "op-7",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: `~/Library/LaunchAgents/${LABEL}.plist`,
    currentHash: "a".repeat(64),
    proposedHash: "b".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    summary: "edit",
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    label: LABEL,
    domain: "GUI",
    filePath: `~/Library/LaunchAgents/${LABEL}.plist`,
    changes: ["RunAtLoad"],
    environmentSet: [],
    environmentRemoved: [],
    backup: "备份",
    reloadNote: "需重新加载",
  };
}

function execution(status: "SUCCEEDED" | "FAILED", fileState: string): EditExecution {
  return {
    operationId: "op-7",
    summary: "edit",
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    status: status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    events: [],
    outcome: {
      kind: "REPLACE",
      status,
      fileState: fileState as EditExecution["outcome"]["fileState"],
      recoveryPoint: "BACKUP",
      backupId: "backup-1",
      summary: "s",
    },
    label: LABEL,
    domain: "GUI",
    filePath: `~/Library/LaunchAgents/${LABEL}.plist`,
    reloadRequired: true,
    reloadNote: "需重新加载",
  };
}

describe("edit origin", () => {
  it("reads the program and arguments the way the plist declares them", () => {
    expect(original()).toMatchObject({
      executable: "/usr/local/bin/tool",
      arguments: ["--serve", "--port=8080"],
      environmentKeys: ["API_TOKEN", "MODE"],
      stdoutPath: "~/Library/Logs/out.log",
      keepAlive: false,
      keepAliveLocked: false,
    });
  });

  it("locks the KeepAlive switch when the plist uses conditions", () => {
    const origin = editOriginalOf(
      launchdService({
        configFiles: [originalFile({ mode: "CONDITIONAL", conditions: ["SuccessfulExit"] })],
      }),
    );
    expect(origin.keepAliveLocked).toBe(true);
    expect(origin.keepAlive).toBe(false);
  });
});

describe("edit request", () => {
  it("refuses an unchanged form, since there is nothing to save", () => {
    const result = buildEditRequest(original(), formOf());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.general).toBe("没有需要修改的字段。");
  });

  it("sends only the argument list that changed, not the executable", () => {
    const base = original();
    const form = formOf({
      arguments: [
        { id: 1, value: "--serve" },
        { id: 2, value: "--port=9090" },
      ],
    }, base);
    const result = buildEditRequest(base, form);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.request.arguments).toEqual(["--serve", "--port=9090"]);
    expect(result.request.executable).toBeUndefined();
    expect(result.request.runAtLoad).toBeUndefined();
    expect(result.request.keepAlive).toBeUndefined();
    expect(result.request.label).toBe(LABEL);
  });

  it("does not require the label to be in UserHome's namespace", () => {
    const base = original({ label: "homebrew.mxcl.caddy" });
    const result = buildEditRequest(
      base,
      formOf({ runAtLoad: true }, base),
    );
    expect(result).toMatchObject({ ok: true, request: { label: "homebrew.mxcl.caddy" } });
  });

  it("sends a switch only when it is flipped", () => {
    const base = original();
    const flipped = buildEditRequest(base, formOf({ runAtLoad: true }, base));
    expect(flipped).toMatchObject({ ok: true, request: { runAtLoad: true } });
    const flippedBack = buildEditRequest(base, formOf({ runAtLoad: false }, base));
    expect(flippedBack.ok).toBe(false);
  });

  it("refuses to flip KeepAlive while the plist keeps it as conditions", () => {
    const base = editOriginalOf(
      launchdService({ configFiles: [originalFile({ mode: "CONDITIONAL", conditions: ["X"] })] }),
    );
    const result = buildEditRequest(base, formOf({ keepAlive: true }, base));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.general).toBe(KEEP_ALIVE_CONDITIONAL_NOTE);
  });

  it("removes a path only when it is cleared, and leaves an absent path absent", () => {
    const base = original();
    const cleared = buildEditRequest(base, formOf({ stdoutPath: "   " }, base));
    expect(cleared).toMatchObject({ ok: true, request: { stdoutPath: "" } });

    const absent = editOriginalOf(
      launchdService({ configFiles: [configFile({ details: plistDetails({ standardOutPath: undefined }) })] }),
    );
    const untouched = buildEditRequest(absent, formOf({ runAtLoad: true, stdoutPath: "" }, absent));
    expect(untouched).toMatchObject({ ok: true });
    if (untouched.ok) expect(untouched.request.stdoutPath).toBeUndefined();
  });

  it("clears the working directory only on request", () => {
    const base = original();
    const result = buildEditRequest(base, formOf({ clearWorkingDirectory: true }, base));
    expect(result).toMatchObject({ ok: true, request: { workingDirectory: "" } });
  });

  it("sends values for new variables and removals for existing names", () => {
    const base = original();
    let form = formOf({}, base);
    form = addEnvironment(form);
    form = updateEnvironmentKey(form, form.nextRowId - 1, "NEW_FLAG");
    form = updateEnvironmentValue(form, form.nextRowId - 1, "s3cret-value");
    form = toggleEnvironmentRemoval(form, "API_TOKEN");
    const result = buildEditRequest(base, form);
    expect(result).toMatchObject({
      ok: true,
      request: {
        environmentSet: { NEW_FLAG: "s3cret-value" },
        environmentRemove: ["API_TOKEN"],
      },
    });
  });

  it("lets a variable being set win over its own removal", () => {
    const base = original();
    let form = addEnvironment(formOf({}, base));
    form = updateEnvironmentKey(form, form.nextRowId - 1, "MODE");
    form = updateEnvironmentValue(form, form.nextRowId - 1, "fast");
    form = toggleEnvironmentRemoval(form, "MODE");
    const result = buildEditRequest(base, form);
    expect(result).toMatchObject({
      ok: true,
      request: { environmentSet: { MODE: "fast" }, environmentRemove: [] },
    });
  });

  it("reports a bad variable name without echoing any value", () => {
    const base = original();
    let form = addEnvironment(formOf({}, base));
    form = updateEnvironmentKey(form, form.nextRowId - 1, "bad-name");
    form = updateEnvironmentValue(form, form.nextRowId - 1, "very-secret-value");
    const result = buildEditRequest(base, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).not.toContain("very-secret-value");
    expect(result.errors.environment[form.nextRowId - 1]?.key).toBeTruthy();
  });

  it("applies the create form's argument rules to the edited list", () => {
    const base = original();
    const form = formOf(
      { arguments: [{ id: 1, value: "" }] },
      base,
    );
    const result = buildEditRequest(base, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.arguments[1]).toContain("不能为空");
  });
});

describe("edit flow", () => {
  it("previews, saves and finishes", () => {
    let state: EditDialogState = INITIAL_EDIT_DIALOG;
    state = editDialogReducer(state, { type: "previewRequested" });
    state = editDialogReducer(state, { type: "previewLoaded", preview: preview() });
    expect(state.phase).toBe("preview");
    expect(discardTarget(state)).toBe("op-7");
    state = editDialogReducer(state, { type: "saveRequested" });
    expect(discardTarget(state)).toBeUndefined();
    state = editDialogReducer(state, { type: "saveFinished", execution: execution("SUCCEEDED", "WRITTEN") });
    expect(state.phase).toBe("done");
  });

  it("does not show a success for a write the file state rejects", () => {
    const state = editDialogReducer(
      { phase: "saving", preview: preview() },
      { type: "saveFinished", execution: execution("FAILED", "RESTORED") },
    );
    expect(state.phase).toBe("failed");
    expect(discardTarget(state)).toBeUndefined();
  });

  it("gives up a preview that is walked away from", () => {
    const state = editDialogReducer(
      { phase: "preview", preview: preview() },
      { type: "editRequested" },
    );
    expect(state.phase).toBe("editing");
  });

  it("keeps a refused save distinct from a rejected preview", () => {
    const refused: AppError = { code: "CONFLICT", message: "changed", retryable: false };
    const state = editDialogReducer(
      { phase: "saving", preview: preview() },
      { type: "saveFailed", error: refused },
    );
    expect(state).toEqual({ phase: "failed", preview: preview(), error: refused });
    expect(discardTarget(state)).toBe("op-7");
  });
});

describe("edit wording", () => {
  it("reports a saved file with the reload requirement", () => {
    const done = execution("SUCCEEDED", "WRITTEN");
    expect(wasSaved(done)).toBe(true);
    expect(describeEditOutcome(done).detail).toBe("需重新加载");
  });

  it("explains the file state of a write that did not stand", () => {
    expect(describeEditOutcome(execution("FAILED", "RESTORED")).detail).toContain("已恢复原内容");
    expect(describeEditOutcome(execution("FAILED", "RESTORE_FAILED")).detail).toContain("恢复原内容失败");
  });

  it("shows a grant that could not be revoked beside the result", () => {
    expect(grantNotice(execution("SUCCEEDED", "WRITTEN"))).toBeUndefined();
    const withError = {
      ...execution("SUCCEEDED", "WRITTEN"),
      grantReleaseError: { code: "INTERNAL", message: "revoke failed", retryable: false } as const,
    };
    expect(grantNotice(withError)).toContain("revoke failed");
  });
});
