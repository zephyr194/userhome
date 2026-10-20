import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type {
  CreateServiceExecution,
  CreateServicePreview,
} from "../../ipc/services";
import { CREATE_SERVICE_LIMITS } from "../../ipc/services";
import {
  INITIAL_CREATE_FORM,
  KEEP_ALIVE_IMPACT,
  RUN_AT_LOAD_IMPACT,
  addArgument,
  addEnvironment,
  buildCreateRequest,
  createDialogReducer,
  describeCreateOutcome,
  fullLabel,
  hasErrors,
  moveArgument,
  removeArgument,
  removeEnvironment,
  scrubSecrets,
  setFormField,
  updateArgument,
  updateEnvironmentKey,
  updateEnvironmentValue,
  validateCreateForm,
  type CreateDialogState,
  type CreateFormState,
} from "./createServiceModel";

const NAMESPACE = "com.zephyr194.userhome.agent.";

function form(overrides: Partial<CreateFormState> = {}): CreateFormState {
  return {
    ...INITIAL_CREATE_FORM,
    labelSuffix: "backup",
    executable: "/usr/local/bin/tool",
    ...overrides,
  };
}

function rows<T extends string>(values: T[]) {
  return values.map((value, index) => ({ id: index + 1, value }));
}

describe("create form editing", () => {
  it("starts with both persistence options off and nothing in the lists", () => {
    expect(INITIAL_CREATE_FORM.runAtLoad).toBe(false);
    expect(INITIAL_CREATE_FORM.keepAlive).toBe(false);
    expect(INITIAL_CREATE_FORM.arguments).toEqual([]);
    expect(INITIAL_CREATE_FORM.environment).toEqual([]);
  });

  it("adds, edits, moves and removes arguments by stable id", () => {
    let state = addArgument(addArgument(INITIAL_CREATE_FORM));
    const [first, second] = state.arguments;
    expect(first.id).not.toBe(second.id);
    state = updateArgument(state, first.id, "--once");
    state = updateArgument(state, second.id, "a b");
    expect(state.arguments.map((row) => row.value)).toEqual(["--once", "a b"]);

    state = moveArgument(state, second.id, -1);
    expect(state.arguments.map((row) => row.value)).toEqual(["a b", "--once"]);
    expect(moveArgument(state, second.id, -1)).toBe(state);
    expect(moveArgument(state, first.id, 1)).toBe(state);

    state = removeArgument(state, second.id);
    expect(state.arguments.map((row) => row.value)).toEqual(["--once"]);
    // Ids are never reused after a removal.
    const added = addArgument(state);
    expect(added.arguments.map((row) => row.id)).not.toContain(second.id);
  });

  it("adds, edits and removes environment rows by stable id", () => {
    let state = addEnvironment(INITIAL_CREATE_FORM);
    const [row] = state.environment;
    state = updateEnvironmentKey(state, row.id, "API_KEY");
    state = updateEnvironmentValue(state, row.id, "s3cret value");
    expect(state.environment).toEqual([{ id: row.id, key: "API_KEY", value: "s3cret value" }]);
    expect(removeEnvironment(state, row.id).environment).toEqual([]);
    expect(removeEnvironment(state, 999)).toEqual(state);
  });

  it("sets plain fields without touching the lists", () => {
    const state = setFormField(form(), "runAtLoad", true);
    expect(state.runAtLoad).toBe(true);
    expect(state.keepAlive).toBe(false);
  });

  it("explains what each persistence option does before it is turned on", () => {
    expect(RUN_AT_LOAD_IMPACT).toContain("登录");
    expect(RUN_AT_LOAD_IMPACT).toContain("自动启动");
    expect(KEEP_ALIVE_IMPACT).toContain("退出");
    expect(KEEP_ALIVE_IMPACT).toContain("自动重启");
  });
});

describe("full label", () => {
  it("puts a suffix in the namespace and keeps a full label as it is", () => {
    expect(fullLabel("backup")).toBe(`${NAMESPACE}backup`);
    expect(fullLabel(`${NAMESPACE}backup`)).toBe(`${NAMESPACE}backup`);
    expect(fullLabel("  backup  ")).toBe(`${NAMESPACE}backup`);
    expect(fullLabel("")).toBeUndefined();
    expect(fullLabel(NAMESPACE)).toBeUndefined();
  });
});

describe("create form validation", () => {
  it("accepts a minimal form and builds the typed request", () => {
    const result = buildCreateRequest(form());
    expect(result).toEqual({
      ok: true,
      request: {
        label: "backup",
        executable: "/usr/local/bin/tool",
        arguments: [],
        environment: {},
        runAtLoad: false,
        keepAlive: false,
      },
    });
  });

  it("builds every optional part and keeps argument text exactly as typed", () => {
    const result = buildCreateRequest(
      form({
        arguments: rows(["--name", " spaced  value ", "-c"]),
        workingDirectory: " /Users/me/work ",
        environment: [
          { id: 1, key: "API_KEY", value: " v1 " },
          { id: 2, key: "MODE", value: "prod" },
        ],
        stdoutPath: "/Users/me/logs/out.log",
        stderrPath: "/Users/me/logs/err.log",
        runAtLoad: true,
        keepAlive: true,
        nextRowId: 10,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({
      label: "backup",
      executable: "/usr/local/bin/tool",
      arguments: ["--name", " spaced  value ", "-c"],
      workingDirectory: "/Users/me/work",
      environment: { API_KEY: " v1 ", MODE: "prod" },
      stdoutPath: "/Users/me/logs/out.log",
      stderrPath: "/Users/me/logs/err.log",
      runAtLoad: true,
      keepAlive: true,
    });
  });

  it("ignores fully blank environment rows but not half-filled ones", () => {
    const blank = buildCreateRequest(
      form({ environment: [{ id: 1, key: "", value: "" }] }),
    );
    expect(blank).toMatchObject({ ok: true, request: { environment: {} } });
    const half = validateCreateForm(
      form({ environment: [{ id: 1, key: "", value: "x" }] }),
    );
    expect(half.environment[1]?.key).toBeTruthy();
  });

  it("refuses a bad label", () => {
    for (const labelSuffix of [
      "",
      " ",
      NAMESPACE,
      ".a",
      "-a",
      "a..b",
      "a.",
      "a b",
      "a/b",
      "é",
      "a".repeat(CREATE_SERVICE_LIMITS.labelSuffixBytes + 1),
    ]) {
      expect(validateCreateForm(form({ labelSuffix })).label, labelSuffix).toBeTruthy();
    }
    expect(validateCreateForm(form()).label).toBeUndefined();
    expect(
      validateCreateForm(form({ labelSuffix: "a".repeat(CREATE_SERVICE_LIMITS.labelSuffixBytes) })).label,
    ).toBeUndefined();
  });

  it("refuses a relative or non-normal executable path", () => {
    for (const executable of [
      "",
      "tool",
      "./tool",
      "~/bin/tool",
      "/usr/../bin/tool",
      "/usr/./bin/tool",
      "/usr//bin/tool",
      "/usr/bin/tool/",
      "/",
      "/usr/bin/to\nol",
    ]) {
      expect(validateCreateForm(form({ executable })).executable, executable).toBeTruthy();
    }
  });

  it("refuses a shell or wrapper as the program, with a reason", () => {
    for (const executable of [
      "/bin/sh",
      "/bin/bash",
      "/bin/zsh",
      "/usr/bin/env",
      "/usr/bin/sudo",
      "/opt/homebrew/bin/fish",
    ]) {
      const message = validateCreateForm(form({ executable })).executable;
      expect(message, executable).toContain("shell");
    }
  });

  it("refuses arguments that borrow a shell, but not a plain -c option", () => {
    for (const values of [
      ["bash", "-c", "x"],
      ["/bin/sh", "-c", "x"],
      ["zsh", "-lc", "x"],
      ["/usr/bin/env", "tool"],
      ["sh"],
    ]) {
      const errors = validateCreateForm(form({ arguments: rows(values) }));
      expect(Object.keys(errors.arguments).length, values.join(" ")).toBeGreaterThan(0);
    }
    expect(
      hasErrors(validateCreateForm(form({ arguments: rows(["-c", "config.toml"]) }))),
    ).toBe(false);
  });

  it("bounds and checks arguments", () => {
    const tooMany = form({
      arguments: rows(Array.from({ length: CREATE_SERVICE_LIMITS.arguments + 1 }, () => "a")),
    });
    expect(validateCreateForm(tooMany).general).toBeTruthy();
    const longArgument = form({
      arguments: rows(["x".repeat(CREATE_SERVICE_LIMITS.argumentBytes + 1)]),
    });
    expect(validateCreateForm(longArgument).arguments[1]).toBeTruthy();
    // Bytes, not characters.
    const multibyte = form({
      arguments: rows(["é".repeat(CREATE_SERVICE_LIMITS.argumentBytes / 2 + 1)]),
    });
    expect(validateCreateForm(multibyte).arguments[1]).toBeTruthy();
    for (const value of ["a\nb", "a\u0000b", "a‮b", "a b", "a\u0085b", ""]) {
      expect(
        validateCreateForm(form({ arguments: rows([value]) })).arguments[1],
        JSON.stringify(value),
      ).toBeTruthy();
    }
  });

  it("checks environment names, reserved names, duplicates and values", () => {
    const check = (entries: Array<[string, string]>) =>
      validateCreateForm(
        form({
          environment: entries.map(([key, value], index) => ({ id: index + 1, key, value })),
        }),
      );
    for (const key of ["1A", "A-B", "A B", "A=B", "é", "a.b"]) {
      expect(check([[key, "v"]]).environment[1]?.key, key).toBeTruthy();
    }
    expect(check([["_OK_1", "has spaces"]]).environment[1]).toBeUndefined();
    for (const key of ["DYLD_INSERT_LIBRARIES", "LD_PRELOAD"]) {
      expect(check([[key, "v"]]).environment[1]?.key, key).toContain("保留");
    }
    const duplicate = check([
      ["A", "1"],
      ["A", "2"],
    ]);
    expect(duplicate.environment[2]?.key).toBeTruthy();
    expect(check([["A", "a\nb"]]).environment[1]?.value).toBeTruthy();
    expect(
      check([["A", "x".repeat(CREATE_SERVICE_LIMITS.environmentValueBytes + 1)]]).environment[1]
        ?.value,
    ).toBeTruthy();
    expect(
      check(
        Array.from({ length: CREATE_SERVICE_LIMITS.environmentEntries + 1 }, (_, index) => [
          `K${index}`,
          "v",
        ]),
      ).general,
    ).toBeTruthy();
  });

  it("checks the optional paths", () => {
    for (const field of ["workingDirectory", "stdoutPath", "stderrPath"] as const) {
      for (const path of ["relative/x", "~/x", "/a/../b", "/a//b", "/a/b/", "/a\nb"]) {
        expect(
          validateCreateForm(form({ [field]: path }))[field],
          `${field} ${path}`,
        ).toBeTruthy();
      }
      expect(validateCreateForm(form({ [field]: "" }))[field]).toBeUndefined();
      expect(validateCreateForm(form({ [field]: "  " }))[field]).toBeUndefined();
      expect(validateCreateForm(form({ [field]: "/Users/me/x.log" }))[field]).toBeUndefined();
    }
  });

  it("returns the errors instead of a request when the form is invalid", () => {
    const result = buildCreateRequest(form({ executable: "tool" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.executable).toBeTruthy();
  });

  it("never puts environment values into an error text", () => {
    const secret = "s3cret-value-123";
    const errors = validateCreateForm(
      form({
        executable: "tool",
        environment: [{ id: 1, key: "1BAD", value: `${secret}\n` }],
      }),
    );
    expect(JSON.stringify(errors)).not.toContain(secret);
  });
});

describe("scrubbing secrets from text", () => {
  it("hides every environment value that appears in a message", () => {
    const state = form({
      environment: [
        { id: 1, key: "API_KEY", value: "s3cret-value-123" },
        { id: 2, key: "MODE", value: "x" },
      ],
    });
    expect(scrubSecrets("failed for s3cret-value-123 and s3cret-value-123", state)).toBe(
      "failed for [已隐藏] and [已隐藏]",
    );
    // A one-character value would wreck the message; it is not scrubbed.
    expect(scrubSecrets("x marks", state)).toBe("x marks");
  });
});

const PREVIEW = {
  operationId: "op-1",
  label: `${NAMESPACE}backup`,
} as unknown as CreateServicePreview;

function execution(overrides: Record<string, unknown> = {}, outcome: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    label: `${NAMESPACE}backup`,
    filePath: `~/Library/LaunchAgents/${NAMESPACE}backup.plist`,
    loaded: false,
    effectNote: "配置文件已创建。新任务尚未加载，也未启动。",
    status: "SUCCEEDED",
    outcome: {
      kind: "CREATE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "NONE_CREATED",
      summary: "ok",
      ...outcome,
    },
    ...overrides,
  } as unknown as CreateServiceExecution;
}

const REFUSED: AppError = {
  code: "CONFLICT",
  message: "已存在同名配置文件，不会覆盖；编辑已有任务是另一项操作，请换一个名称。",
  retryable: false,
};

describe("create dialog flow", () => {
  const editing: CreateDialogState = { phase: "editing" };

  it("goes editing → previewing → preview → creating → done", () => {
    let state = createDialogReducer(editing, { type: "previewRequested" });
    expect(state).toEqual({ phase: "previewing" });
    state = createDialogReducer(state, { type: "previewLoaded", preview: PREVIEW });
    expect(state).toEqual({ phase: "preview", preview: PREVIEW });
    state = createDialogReducer(state, { type: "confirmRequested" });
    expect(state).toEqual({ phase: "creating", preview: PREVIEW });
    const done = execution();
    state = createDialogReducer(state, { type: "createFinished", execution: done });
    expect(state).toEqual({ phase: "done", execution: done });
  });

  it("returns to editing with the refusal when the preview is refused", () => {
    const state = createDialogReducer(
      { phase: "previewing" },
      { type: "previewFailed", error: REFUSED },
    );
    expect(state).toEqual({ phase: "editing", error: REFUSED });
  });

  it("does not let a stale event move the dialog", () => {
    expect(createDialogReducer(editing, { type: "confirmRequested" })).toBe(editing);
    expect(createDialogReducer(editing, { type: "previewLoaded", preview: PREVIEW })).toBe(editing);
    const done: CreateDialogState = { phase: "done", execution: execution() };
    expect(createDialogReducer(done, { type: "previewRequested" })).toBe(done);
    const creating: CreateDialogState = { phase: "creating", preview: PREVIEW };
    expect(createDialogReducer(creating, { type: "editRequested" })).toBe(creating);
    expect(createDialogReducer(creating, { type: "previewRequested" })).toBe(creating);
  });

  it("goes back to editing from the preview", () => {
    expect(
      createDialogReducer({ phase: "preview", preview: PREVIEW }, { type: "editRequested" }),
    ).toEqual({ phase: "editing" });
  });

  it("reports a refused confirmation as a failure with nothing written", () => {
    const state = createDialogReducer(
      { phase: "creating", preview: PREVIEW },
      { type: "createFailed", error: REFUSED },
    );
    expect(state).toEqual({ phase: "failed", preview: PREVIEW, error: REFUSED });
    expect(createDialogReducer(state, { type: "editRequested" })).toEqual({
      phase: "editing",
    });
  });

  it("treats a transaction that ran but did not write as a failure, not as done", () => {
    for (const outcome of [
      { status: "FAILED", fileState: "CREATED_REMOVED" },
      { status: "FAILED", fileState: "CREATED_REMOVE_FAILED" },
      { status: "FAILED", fileState: "UNKNOWN" },
      { status: "SUCCEEDED", fileState: "UNKNOWN" },
    ]) {
      const result = execution({}, outcome);
      const state = createDialogReducer(
        { phase: "creating", preview: PREVIEW },
        { type: "createFinished", execution: result },
      );
      expect(state.phase, JSON.stringify(outcome)).toBe("failed");
    }
  });
});

describe("describing the outcome", () => {
  it("says the job was created but is not loaded", () => {
    const text = describeCreateOutcome(execution());
    expect(text.tone).toBe("success");
    expect(text.title).toContain("已创建");
    expect(text.detail).toContain("尚未加载");
  });

  it("states exactly what is known about the file after a failed write", () => {
    const removed = describeCreateOutcome(
      execution({}, { status: "FAILED", fileState: "CREATED_REMOVED" }),
    );
    expect(removed.tone).toBe("danger");
    expect(removed.detail).toContain("已删除");
    const stuck = describeCreateOutcome(
      execution({}, { status: "FAILED", fileState: "CREATED_REMOVE_FAILED" }),
    );
    expect(stuck.detail).toContain("仍可能存在");
    const unknown = describeCreateOutcome(
      execution({}, { status: "FAILED", fileState: "UNKNOWN" }),
    );
    expect(unknown.detail).toContain("无法确认");
  });
});
