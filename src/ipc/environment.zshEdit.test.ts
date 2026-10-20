import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeZshEditEnabled,
  decodeZshEditExecution,
  decodeZshEditOutcome,
  decodeZshEditPreview,
  enableZshEdit,
  executeZshEdit,
  previewZshEdit,
  readZshEditState,
  zshEditProblem,
  type ZshBlockEdit,
} from "./environment";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const OTHER_GRANT = "9a7b3f2b-8c1e-4e6f-5d4a-1c2d3e4f5a6b";
const HASH = "b".repeat(64);
const SECRET_TEXT = "hunter2-very-secret";

afterEach(() => {
  clearMocks();
});

// ---- wire fixtures -----------------------------------------------------------------

function wireVariable(overrides: Record<string, unknown> = {}) {
  return {
    name: "EDITOR",
    line: 3,
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    ...overrides,
  };
}

function wireState(overrides: Record<string, unknown> = {}) {
  return {
    status: "READY",
    file: "ZSHRC",
    name: ".zshrc",
    appliesTo: "INTERACTIVE",
    position: 6,
    displayPath: "~/.zshrc",
    fullPath: "/Users/me/.zshrc",
    exists: true,
    contentHash: HASH,
    enabled: true,
    grantId: GRANT_ID,
    block: {
      status: "PRESENT",
      beginLine: 2,
      endLine: 6,
      variables: [
        wireVariable(),
        wireVariable({
          name: "API_TOKEN",
          line: 4,
          secret: true,
          valueLength: 12,
          value: null,
        }),
      ],
      path: ["/opt/tool/bin", "$HOME/bin"],
    },
    outside: {
      variables: [
        { name: "EDITOR", line: 1, beforeBlock: true, state: "STATIC", secret: false },
      ],
      path: [
        {
          line: 8,
          beforeBlock: false,
          operation: "SET",
          state: "DYNAMIC",
          reason: "COMMAND_SUBSTITUTION",
          segments: [
            { text: "$(brew --prefix)/bin", state: "DYNAMIC" },
            { text: "$PATH", state: "REFERENCE" },
          ],
        },
        {
          line: 9,
          beforeBlock: false,
          operation: "APPEND",
          state: "STATIC",
          reason: null,
          segments: [{ text: "/opt/static", state: "STATIC" }],
        },
      ],
      dynamicPathLines: [
        { line: 10, beforeBlock: false, reason: "BLOCK", text: "if x; then PATH=y", withheld: false },
        { line: 11, beforeBlock: false, reason: null, text: null, withheld: true },
      ],
      truncated: false,
    },
    ...overrides,
  };
}

function wireChange(overrides: Record<string, unknown> = {}) {
  return {
    name: "GOPATH",
    change: "ADD",
    secret: false,
    after: "/Users/me/go",
    omitted: false,
    ...overrides,
  };
}

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: "Replace ~/.zshrc.",
    effects: ["Target: ~/.zshrc"],
    requiresElevation: false,
    expiresAt: "2026-10-16T10:05:00Z",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: "~/.zshrc",
    currentHash: HASH,
    proposedHash: "c".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    file: "ZSHRC",
    appliesTo: "INTERACTIVE",
    position: 6,
    displayPath: "~/.zshrc",
    fullPath: "/Users/me/.zshrc",
    createdBlock: true,
    variableChanges: [wireChange()],
    pathChange: { before: [], after: ["$HOME/bin", "/opt/tool/bin"] },
    blockDiff: [
      { kind: "ADDED", text: "# >>> UserHome managed block (zsh) >>>" },
      { kind: "ADDED", text: "export GOPATH='/Users/me/go'" },
    ],
    warnings: [
      { kind: "BLOCK_APPENDED" },
      { kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "EDITOR", line: 1 },
    ],
    effectNote: "改动仅对之后新开的终端可能生效。",
    ...overrides,
  };
}

function wireExecution(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    summary: "Replace ~/.zshrc.",
    effects: [],
    requiresElevation: false,
    expiresAt: "2026-10-16T10:05:00Z",
    status: "SUCCEEDED",
    events: [],
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      backupId: "b-1",
      summary: "The file was written and verified.",
    },
    file: "ZSHRC",
    effectNote: "改动仅对之后新开的终端可能生效。",
    ...overrides,
  };
}

const EDIT: ZshBlockEdit = {
  variables: [
    { op: "SET", name: "GOPATH", value: "/Users/me/go" },
    { op: "REMOVE", name: "OLD" },
  ],
  path: ["~/bin", "/opt/tool/bin"],
};

async function rejected(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT" });
}

// ---- calls ----------------------------------------------------------------------------

describe("zsh edit IPC", () => {
  it("reads the state with only a file key (and the chosen ZDOTDIR directory)", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_zsh_edit_state");
      expect(payload).toEqual({ input: { file: "ZSHRC" } });
      return wireState();
    });
    const outcome = await readZshEditState({ file: "ZSHRC" });
    expect(outcome.status).toBe("READY");

    mockIPC((_command, payload) => {
      expect(payload).toEqual({ input: { file: "ZPROFILE", zdotdirGrantId: GRANT_ID } });
      return { status: "NOT_LOCATED", message: "未确定" };
    });
    await expect(
      readZshEditState({ file: "ZPROFILE", zdotdirGrantId: GRANT_ID }),
    ).resolves.toEqual({ status: "NOT_LOCATED", message: "未确定" });
  });

  it("enables editing with the same input and never a path or an id for the file", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("enable_zsh_edit");
      expect(payload).toEqual({ input: { file: "ZSHRC" } });
      return {
        file: "ZSHRC",
        displayPath: "~/.zshrc",
        fullPath: "/Users/me/.zshrc",
        exists: false,
        grantId: GRANT_ID,
      };
    });
    const enabled = await enableZshEdit({ file: "ZSHRC" });
    expect(enabled).toEqual({
      file: "ZSHRC",
      displayPath: "~/.zshrc",
      fullPath: "/Users/me/.zshrc",
      exists: false,
      grantId: GRANT_ID,
    });
  });

  it("previews with the hash it showed, or null for a file that does not exist", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_zsh_edit");
      expect(payload).toEqual({
        input: {
          file: "ZSHRC",
          expectedHash: HASH,
          edit: {
            variables: [
              { op: "SET", name: "GOPATH", value: "/Users/me/go" },
              { op: "REMOVE", name: "OLD" },
            ],
            path: ["~/bin", "/opt/tool/bin"],
          },
        },
      });
      return wirePreview();
    });
    const preview = await previewZshEdit({ file: "ZSHRC" }, HASH, EDIT);
    expect(preview.operationId).toBe("op-1");
    expect(preview.warnings).toHaveLength(2);

    mockIPC((_command, payload) => {
      expect(payload).toEqual({
        input: {
          file: "ZLOGIN",
          zdotdirGrantId: GRANT_ID,
          expectedHash: null,
          edit: { variables: [{ op: "SET", name: "A", value: "1" }] },
        },
      });
      return wirePreview({
        kind: "CREATE",
        recoveryPoint: "NONE_CREATED",
        currentHash: undefined,
        file: "ZLOGIN",
        appliesTo: "LOGIN",
        position: 8,
        warnings: [{ kind: "FILE_CREATED" }, { kind: "BLOCK_APPENDED" }],
      });
    });
    const created = await previewZshEdit(
      { file: "ZLOGIN", zdotdirGrantId: GRANT_ID },
      undefined,
      { variables: [{ op: "SET", name: "A", value: "1" }] },
    );
    expect(created.kind).toBe("CREATE");
  });

  it("confirms with the operation id and the file only", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_zsh_edit");
      expect(payload).toEqual({ input: { operationId: "op-1", file: "ZSHRC" } });
      return wireExecution();
    });
    const execution = await executeZshEdit({
      operationId: "op-1",
      target: { file: "ZSHRC" },
    });
    expect(execution.outcome.fileState).toBe("WRITTEN");
    expect(execution.file).toBe("ZSHRC");
  });

  it("refuses bad input before calling the backend", async () => {
    mockIPC(() => {
      throw new Error("must not be called");
    });
    for (const target of [
      { file: ".zshrc" },
      { file: "/etc/zshrc" },
      { file: "ZSHRC", zdotdirGrantId: "../x" },
      { file: "ZSHRC", zdotdirGrantId: "/Users/me/.config" },
    ]) {
      const typed = target as Parameters<typeof readZshEditState>[0];
      await rejected(readZshEditState(typed));
      await rejected(enableZshEdit(typed));
      await rejected(previewZshEdit(typed, HASH, EDIT));
      await rejected(executeZshEdit({ operationId: "op-1", target: typed }));
    }
    await rejected(previewZshEdit({ file: "ZSHRC" }, "xyz", EDIT));
    await rejected(previewZshEdit({ file: "ZSHRC" }, HASH.toUpperCase(), EDIT));
    await rejected(previewZshEdit({ file: "ZSHRC" }, HASH, { variables: [] }));
    await rejected(executeZshEdit({ operationId: "", target: { file: "ZSHRC" } }));
  });
});

describe("zsh edit problems", () => {
  const set = (name: string, value = "1") => ({ op: "SET" as const, name, value });

  it("accepts a normal edit and refuses everything the backend would", () => {
    expect(zshEditProblem(EDIT)).toBeUndefined();
    expect(zshEditProblem({ variables: [], path: [] })).toBeUndefined();
    expect(zshEditProblem({ variables: [] })).toBe("没有需要保存的改动。");
    expect(zshEditProblem({ variables: [set("1BAD")] })).toMatch(/变量名/);
    expect(zshEditProblem({ variables: [set("A B")] })).toMatch(/变量名/);
    expect(zshEditProblem({ variables: [set("PATH")] })).toMatch(/PATH 列表/);
    expect(zshEditProblem({ variables: [set("path")] })).toMatch(/PATH 列表/);
    expect(zshEditProblem({ variables: [set("A"), { op: "REMOVE", name: "A" }] })).toMatch(/只能改动一次/);
    expect(zshEditProblem({ variables: [set("A", "é".repeat(8193))] })).toMatch(/8192/);
    expect(zshEditProblem({ variables: [set("A", "é".repeat(8192))] })).toBeUndefined();
    expect(
      zshEditProblem({ variables: Array.from({ length: 129 }, (_, i) => set(`V${i}`)) }),
    ).toMatch(/128/);
    expect(
      zshEditProblem({ variables: [], path: Array.from({ length: 65 }, (_, i) => `/p${i}`) }),
    ).toMatch(/64/);
    expect(
      zshEditProblem({ variables: [{ op: "TRUNCATE", name: "A" } as never] }),
    ).toBe("不支持的改动类型。");
    expect(
      zshEditProblem({ variables: [{ op: "REMOVE", name: "A", value: "x" } as never] }),
    ).toBe("删除不带值。");
  });
});

// ---- decoding ---------------------------------------------------------------------------

describe("zsh edit state decoding", () => {
  it("decodes the block, the outside view and the authorization", () => {
    const outcome = decodeZshEditOutcome(wireState());
    if (outcome.status !== "READY") throw new Error("expected READY");
    expect(outcome.enabled).toBe(true);
    expect(outcome.grantId).toBe(GRANT_ID);
    expect(outcome.contentHash).toBe(HASH);
    if (outcome.block.status !== "PRESENT") throw new Error("expected PRESENT");
    expect(outcome.block.variables[0]?.value).toBe("vim");
    expect(outcome.block.variables[1]?.secret).toBe(true);
    expect(outcome.block.variables[1]?.value).toBeUndefined();
    expect(outcome.block.path).toEqual(["/opt/tool/bin", "$HOME/bin"]);
    expect(outcome.outside.path[0]).toMatchObject({ state: "DYNAMIC", reason: "COMMAND_SUBSTITUTION" });
    expect(outcome.outside.path[1]?.reason).toBeUndefined();
    expect(outcome.outside.dynamicPathLines[1]).toMatchObject({ withheld: true });
    expect(outcome.outside.dynamicPathLines[1]?.text).toBeUndefined();
  });

  it("decodes a missing file, an absent block and the broken kinds", () => {
    const missing = decodeZshEditOutcome(
      wireState({ exists: false, contentHash: null, enabled: false, grantId: null, block: { status: "ABSENT" } }),
    );
    if (missing.status !== "READY") throw new Error("expected READY");
    expect(missing.contentHash).toBeUndefined();
    expect(missing.grantId).toBeUndefined();
    expect(missing.block).toEqual({ status: "ABSENT" });
    for (const kind of ["MISSING_END", "MISSING_BEGIN", "WRONG_ORDER", "NESTED", "DUPLICATE", "UNMANAGED"]) {
      const broken = decodeZshEditOutcome(
        wireState({ block: { status: "BROKEN", kind, line: 3, message: "第 3 行有问题" } }),
      );
      if (broken.status !== "READY") throw new Error("expected READY");
      expect(broken.block).toMatchObject({ status: "BROKEN", kind, line: 3 });
    }
  });

  it("decodes the three non-ready outcomes", () => {
    expect(
      decodeZshEditOutcome({ status: "UNAVAILABLE", reason: "IO", message: "读取出错" }),
    ).toEqual({ status: "UNAVAILABLE", reason: "IO", message: "读取出错" });
    expect(decodeZshEditOutcome({ status: "OUTSIDE_HOME", message: "越界" })).toEqual({
      status: "OUTSIDE_HOME",
      message: "越界",
    });
    expect(decodeZshEditOutcome({ status: "NOT_LOCATED", message: "未确定" }).status).toBe(
      "NOT_LOCATED",
    );
  });

  it("rejects malformed or untrustworthy state payloads", () => {
    const bad: unknown[] = [
      null,
      "READY",
      [],
      { status: "WHATEVER" },
      { status: "UNAVAILABLE", reason: "NOPE", message: "x" },
      { status: "UNAVAILABLE", reason: "IO", message: "" },
      { status: "OUTSIDE_HOME", message: "bad\nmessage" },
      wireState({ file: "ZSHRX" }),
      wireState({ name: ".zprofile" }),
      wireState({ appliesTo: "SOMETIMES" }),
      wireState({ position: -1 }),
      wireState({ position: 1.5 }),
      wireState({ displayPath: "relative/.zshrc" }),
      wireState({ fullPath: "~/.zshrc" }),
      wireState({ fullPath: "/Users/me/\n.zshrc" }),
      wireState({ exists: false }), // a hash without a file
      wireState({ contentHash: null }), // a file without a hash
      wireState({ contentHash: "xyz" }),
      wireState({ enabled: false }), // a grant while editing is off
      wireState({ grantId: null }), // enabled without a grant
      wireState({ grantId: "../etc" }),
      wireState({ enabled: "yes" }),
      wireState({ block: null }),
      wireState({ block: { status: "ODD" } }),
      wireState({ block: { status: "BROKEN", kind: "ODD", line: 1, message: "x" } }),
      wireState({ block: { status: "BROKEN", kind: "NESTED", line: 0, message: "x" } }),
      wireState({ block: { status: "BROKEN", kind: "NESTED", line: 1, message: "" } }),
      wireState({ block: { status: "PRESENT", beginLine: 3, endLine: 3, variables: [], path: [] } }),
      wireState({ block: { status: "PRESENT", beginLine: 0, endLine: 3, variables: [], path: [] } }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable(), wireVariable()], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable({ name: "PATH" })], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable({ name: "1X" })], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 4, endLine: 9, variables: [wireVariable({ line: 2 })], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable({ line: 9 })], path: [] },
      }),
      wireState({
        block: {
          status: "PRESENT",
          beginLine: 1,
          endLine: 9,
          variables: [wireVariable({ secret: true, value: SECRET_TEXT, valueLength: SECRET_TEXT.length })],
          path: [],
        },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable({ valueLength: 9 })], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [wireVariable({ hasValue: false })], path: [] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [], path: ["relative"] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [], path: ["$HOMEX/bin"] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [], path: [""] },
      }),
      wireState({
        block: { status: "PRESENT", beginLine: 1, endLine: 9, variables: [], path: Array.from({ length: 65 }, (_, i) => `/p${i}`) },
      }),
      wireState({ outside: null }),
      wireState({ outside: { variables: [], path: [], dynamicPathLines: [] } }),
      wireState({
        outside: {
          variables: [{ name: "A", line: 0, beforeBlock: true, state: "STATIC", secret: false }],
          path: [],
          dynamicPathLines: [],
          truncated: false,
        },
      }),
      wireState({
        outside: {
          variables: [],
          path: [{ line: 1, beforeBlock: true, operation: "SET", state: "DYNAMIC", reason: null, segments: [] }],
          dynamicPathLines: [],
          truncated: false,
        },
      }),
      wireState({
        outside: {
          variables: [],
          path: [{ line: 1, beforeBlock: true, operation: "SET", state: "STATIC", reason: "BLOCK", segments: [] }],
          dynamicPathLines: [],
          truncated: false,
        },
      }),
      wireState({
        outside: {
          variables: [],
          path: [{ line: 1, beforeBlock: true, operation: "MOVE", state: "STATIC", reason: null, segments: [] }],
          dynamicPathLines: [],
          truncated: false,
        },
      }),
      wireState({
        outside: {
          variables: [],
          path: [],
          dynamicPathLines: [{ line: 1, beforeBlock: true, reason: null, text: "x", withheld: true }],
          truncated: false,
        },
      }),
      wireState({
        outside: { variables: [], path: [], dynamicPathLines: [], truncated: "no" },
      }),
    ];
    for (const payload of bad) {
      expect(() => decodeZshEditOutcome(payload), JSON.stringify(payload)).toThrow();
    }
  });

  it("decodes the enabled result and rejects odd ones", () => {
    const ok = {
      file: "ZSHENV",
      displayPath: "~/.zshenv",
      fullPath: "/Users/me/.zshenv",
      exists: true,
      grantId: OTHER_GRANT,
    };
    expect(decodeZshEditEnabled(ok).grantId).toBe(OTHER_GRANT);
    for (const bad of [
      null,
      { ...ok, grantId: "nope" },
      { ...ok, grantId: undefined },
      { ...ok, file: "OTHER" },
      { ...ok, fullPath: "relative" },
      { ...ok, displayPath: "x" },
      { ...ok, exists: 1 },
    ]) {
      expect(() => decodeZshEditEnabled(bad)).toThrow();
    }
  });
});

describe("zsh edit preview decoding", () => {
  it("decodes changes, the path change, the managed-line diff and the warnings", () => {
    const preview = decodeZshEditPreview(
      wirePreview({
        variableChanges: [
          wireChange(),
          wireChange({ name: "OLD", change: "REMOVE", before: "x", after: undefined }),
          wireChange({ name: "PORT", change: "MODIFY", before: "1", after: "2" }),
          wireChange({ name: "API_TOKEN", secret: true, after: undefined }),
        ],
        warnings: [
          { kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "A", line: 1 },
          { kind: "OVERRIDDEN_BY_LATER_ASSIGNMENT", name: "B", line: 9 },
          { kind: "DUPLICATE_PATH_ITEM", item: "/a" },
          { kind: "PATH_ITEM_ALSO_OUTSIDE", item: "/a", line: 3 },
          { kind: "DYNAMIC_PATH_OUTSIDE", line: 4 },
          { kind: "LATER_PATH_ASSIGNMENT", line: 5 },
          { kind: "BLOCK_APPENDED" },
          { kind: "FILE_CREATED" },
        ],
      }),
    );
    expect(preview.variableChanges).toHaveLength(4);
    expect(preview.variableChanges[3]).toEqual({
      name: "API_TOKEN",
      change: "ADD",
      secret: true,
      omitted: false,
    });
    expect(preview.pathChange).toEqual({
      before: [],
      after: ["$HOME/bin", "/opt/tool/bin"],
    });
    expect(preview.blockDiff[1]).toEqual({ kind: "ADDED", text: "export GOPATH='/Users/me/go'" });
    expect(preview.warnings.map((warning) => warning.kind)).toHaveLength(8);
    expect(preview.createdBlock).toBe(true);
    expect(preview.fullPath).toBe("/Users/me/.zshrc");
  });

  it("allows a path-only change and a variables-only change", () => {
    expect(decodeZshEditPreview(wirePreview({ variableChanges: [] })).pathChange).toBeDefined();
    expect(
      decodeZshEditPreview(wirePreview({ pathChange: null })).pathChange,
    ).toBeUndefined();
  });

  it("rejects malformed or untrustworthy previews", () => {
    const bad: Record<string, unknown>[] = [
      { diff: { lines: [{ kind: "ADDED", text: `PASSWORD=${SECRET_TEXT}` }], redacted: false, truncated: false } },
      { diff: { lines: [], redacted: false, truncated: false } },
      { variableChanges: [], pathChange: null },
      { variableChanges: [wireChange(), wireChange()] },
      { variableChanges: [wireChange({ name: "1X" })] },
      { variableChanges: [wireChange({ change: "RENAME" })] },
      { variableChanges: [wireChange({ secret: true })] }, // a secret with text
      { variableChanges: [wireChange({ secret: true, after: undefined, omitted: true })] },
      { variableChanges: [wireChange({ after: undefined })] }, // missing without a reason
      { variableChanges: [wireChange({ omitted: true })] }, // reason without a gap
      { variableChanges: [wireChange({ before: "x" })] }, // an ADD with a before
      { variableChanges: [wireChange({ change: "REMOVE", before: "x", after: "y" })] },
      { variableChanges: "none" },
      { variableChanges: Array.from({ length: 129 }, (_, i) => wireChange({ name: `V${i}` })) },
      { pathChange: { before: [], after: ["relative"] } },
      { pathChange: { before: "x", after: [] } },
      { pathChange: [] },
      { blockDiff: [{ kind: "CONTEXT", text: "x" }] },
      { blockDiff: [{ kind: "ADDED" }] },
      { blockDiff: "x" },
      { blockDiff: Array.from({ length: 301 }, () => ({ kind: "ADDED", text: "x" })) },
      { warnings: [{ kind: "SOMETHING_ELSE" }] },
      { warnings: [{ kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "A" }] },
      { warnings: [{ kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "1A", line: 1 }] },
      { warnings: [{ kind: "DYNAMIC_PATH_OUTSIDE", line: 0 }] },
      { warnings: [{ kind: "DUPLICATE_PATH_ITEM", item: "" }] },
      { warnings: "none" },
      { file: "ZSHRX" },
      { appliesTo: "NEVER" },
      { position: "6" },
      { displayPath: "no/tilde" },
      { fullPath: "relative/.zshrc" },
      { createdBlock: "yes" },
      { effectNote: "" },
      { effectNote: 7 },
      // The generic envelope still has to be a valid, consistent write preview.
      { kind: "CREATE" },
      { recoveryPoint: "BACKUP", kind: "CREATE", currentHash: undefined },
      { proposedHash: "nope" },
    ];
    for (const overrides of bad) {
      expect(
        () => decodeZshEditPreview(wirePreview(overrides)),
        JSON.stringify(overrides),
      ).toThrow();
    }
    for (const payload of [null, "preview", [], 7]) {
      expect(() => decodeZshEditPreview(payload)).toThrow();
    }
  });

  it("never lets a secret value through a payload that claims to hold one", () => {
    expect(() =>
      decodeZshEditPreview(
        wirePreview({
          variableChanges: [wireChange({ name: "API_TOKEN", secret: true, after: SECRET_TEXT })],
        }),
      ),
    ).toThrow();
    try {
      decodeZshEditPreview(
        wirePreview({
          variableChanges: [wireChange({ name: "API_TOKEN", secret: true, after: SECRET_TEXT })],
        }),
      );
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(SECRET_TEXT);
    }
  });
});

describe("zsh edit execution decoding", () => {
  it("decodes the outcome plus the file and the note", () => {
    const execution = decodeZshEditExecution(wireExecution());
    expect(execution.outcome).toMatchObject({ status: "SUCCEEDED", fileState: "WRITTEN" });
    expect(execution.file).toBe("ZSHRC");
    expect(execution.effectNote).toContain("新开的终端");
  });

  it("rejects malformed executions", () => {
    for (const overrides of [
      { file: "NOPE" },
      { effectNote: "" },
      { effectNote: undefined },
      { outcome: null },
      { outcome: { kind: "REPLACE", status: "MAYBE", fileState: "WRITTEN", recoveryPoint: "BACKUP", summary: "x" } },
      { status: "ODD" },
    ]) {
      expect(() => decodeZshEditExecution(wireExecution(overrides)), JSON.stringify(overrides)).toThrow();
    }
    for (const payload of [null, "x", []]) {
      expect(() => decodeZshEditExecution(payload)).toThrow();
    }
  });
});

describe("sensitive variable warnings", () => {
  it("decodes a sensitive-variable warning with only the name", () => {
    const preview = decodeZshEditPreview(
      wirePreview({
        warnings: [
          { kind: "SENSITIVE_VARIABLE", name: "DYLD_INSERT_LIBRARIES" },
          { kind: "SENSITIVE_VARIABLE", name: "IFS" },
        ],
      }),
    );
    expect(preview.warnings).toEqual([
      { kind: "SENSITIVE_VARIABLE", name: "DYLD_INSERT_LIBRARIES" },
      { kind: "SENSITIVE_VARIABLE", name: "IFS" },
    ]);
  });

  it.each([
    ["a missing name", { kind: "SENSITIVE_VARIABLE" }],
    ["an invalid name", { kind: "SENSITIVE_VARIABLE", name: "A B" }],
    ["a non-string name", { kind: "SENSITIVE_VARIABLE", name: 1 }],
  ])("rejects %s", (_label, warning) => {
    expect(() => decodeZshEditPreview(wirePreview({ warnings: [warning] }))).toThrow();
  });
});
