import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EnvEditPreview, EnvFileView, EnvRow } from "../../ipc/environment";
import { DotenvEditor, type DotenvEditorActions } from "./DotenvEditor";
import type { EditorState } from "./dotenvEditorController";
import {
  EMPTY_DRAFTS,
  checkDrafts,
  type EditorTarget,
  type SaveResult,
} from "./dotenvEditorModel";
import { EnvironmentView, type EnvironmentViewProps } from "./EnvironmentView";
import { INITIAL_ENVIRONMENT_STATE } from "./environmentModel";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const SECRET_TEXT = "hunter2-very-secret";

type Entry = Extract<EnvRow, { kind: "ENTRY" }>;

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    kind: "ENTRY",
    line: 1,
    endLine: 1,
    key: "PORT",
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 4,
    value: "3000",
    quote: "NONE",
    flags: [],
    ...overrides,
  };
}

const FILE: EnvFileView = {
  relativePath: ".env",
  kind: "ENVIRONMENT",
  contentHash: "a".repeat(64),
  sizeBytes: 100,
  lineCount: 6,
  rows: [
    { kind: "COMMENT", line: 1, text: "# service", withheld: false },
    entry({ key: "PORT", line: 2 }),
    entry({ key: "API_TOKEN", line: 3, secret: true, value: undefined, valueLength: 6 }),
    entry({ key: "DYN", line: 4, flags: ["INTERPOLATION"], value: "$HOME", valueLength: 5 }),
    entry({ key: "MULTI", line: 5, endLine: 6, flags: ["MULTILINE_VALUE"], value: "a\nb", valueLength: 3 }),
    entry({ key: "ESC", line: 7, quote: "DOUBLE", value: "a\\nb", valueLength: 4 }),
  ],
  rowsTruncated: false,
  entryCount: 5,
  secretCount: 1,
  flaggedCount: 2,
};

const EXISTING: EditorTarget = {
  kind: "existing",
  grantId: GRANT_ID,
  path: ".env",
  settings: { patterns: [".env"], recursive: false },
  file: FILE,
};
const NEW_TARGET: EditorTarget = {
  kind: "new",
  grantId: GRANT_ID,
  displayPath: "~/proj/.env.local",
};

function stateOf(patch: Partial<EditorState> = {}): EditorState {
  return {
    phase: "editing",
    target: EXISTING,
    ...EMPTY_DRAFTS,
    nextId: 1,
    ...patch,
  };
}

const ACTIONS: DotenvEditorActions = {
  addRow: vi.fn(),
  cancelPreview: vi.fn(),
  close: vi.fn(),
  confirm: vi.fn(() => Promise.resolve()),
  removeRow: vi.fn(),
  requestPreview: vi.fn(() => Promise.resolve()),
  resumeEditing: vi.fn(),
  setEntryMode: vi.fn(),
  setEntryValue: vi.fn(),
  updateRow: vi.fn(),
};

function render(state: EditorState): string {
  const check = state.target
    ? checkDrafts(state.target, state)
    : { edits: [], problems: { entries: {}, additions: {} }, ready: false };
  return renderToStaticMarkup(
    <DotenvEditor actions={ACTIONS} check={check} state={state} />,
  );
}

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
    changes: [
      { key: "PORT", change: "MODIFY", secret: false, before: "3000", after: "3001", omitted: false },
      { key: "API_TOKEN", change: "MODIFY", secret: true, omitted: false },
      { key: "NEW_ONE", change: "ADD", secret: false, after: "", omitted: false },
      { key: "OLD", change: "REMOVE", secret: false, before: "gone", omitted: false },
      { key: "LONG", change: "ADD", secret: false, omitted: true },
    ],
    fileKind: "ENVIRONMENT",
    matchesDefaultPatterns: true,
    ...overrides,
  };
}

describe("editing an existing file", () => {
  it("offers a field per editable key and a masked replacement for secrets", () => {
    const markup = render(stateOf());

    expect(markup).toContain("PORT 的值");
    expect(markup).toContain('value="3000"');
    expect(markup).toContain("API_TOKEN 的新值");
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*/);
    expect(markup).toContain("留空表示不修改");
    expect(markup).toContain("删除 PORT");
    expect(markup).toContain("预览改动");
    expect(markup).toContain("取消编辑");
    expect(markup).toContain("注释、空行、未识别行和未改动的键保持原样");
  });

  it("disables the preview until something changed and says so", () => {
    const markup = render(stateOf());
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
    expect(markup).toContain("还没有改动。");
  });

  it("enables the preview for a valid draft", () => {
    const markup = render(
      stateOf({ entryEdits: { PORT: { mode: "set", value: "3001" } } }),
    );
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
  });

  it("marks entries it will not rewrite, with the reason, and gives them no field", () => {
    const markup = render(stateOf());

    expect(markup).toContain("不可修改");
    expect(markup).toContain("变量插值");
    expect(markup).toContain("多行值");
    expect(markup).toContain("转义");
    expect(markup).not.toContain("DYN 的值");
    expect(markup).not.toContain("MULTI 的值");
    expect(markup).not.toContain("ESC 的值");
    expect(markup).not.toContain("删除 DYN");
  });

  it("shows a pending removal and its undo", () => {
    const markup = render(stateOf({ entryEdits: { PORT: { mode: "remove", value: "" } } }));
    expect(markup).toContain("将删除");
    expect(markup).toContain("撤销删除 PORT");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("explains a field problem next to the field and blocks the preview", () => {
    const markup = render(
      stateOf({ entryEdits: { PORT: { mode: "set", value: "a\nb" } } }),
    );
    expect(markup).toContain("控制");
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
    expect(markup).toContain("请先修正标红的字段");
  });

  it("masks the value input of a new key that looks like a secret", () => {
    const markup = render(
      stateOf({
        additions: [
          { id: 1, key: "DB_PASSWORD", value: "", exported: false },
          { id: 2, key: "REGION", value: "", exported: false },
        ],
        nextId: 3,
      }),
    );
    expect(markup).toContain("键名像秘密，输入已遮盖");
    const passwordInputs = markup.match(/type="password"/g) ?? [];
    // The existing secret entry plus the new secret-looking key.
    expect(passwordInputs).toHaveLength(2);
    expect(markup).toContain("写成 export KEY=…");
    expect(markup).toContain("移除第 1 行");
  });

  it("shows the notice that came back from a refused preview", () => {
    const markup = render(
      stateOf({ notice: { tone: "error", text: "预览已过期，没有写入任何内容。请重新预览。", detail: "Operation preview has expired." } }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("预览已过期");
    expect(markup).toContain("Operation preview has expired.");
  });

  it("locks the form while a preview is being made", () => {
    const markup = render(stateOf({ phase: "previewing" }));
    expect(markup).toContain("正在生成预览");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>生成预览中…<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>取消编辑<\/button>/);
  });
});

describe("creating a file", () => {
  it("names the chosen target and offers new keys only", () => {
    const markup = render(stateOf({ target: NEW_TARGET }));
    expect(markup).toContain("~/proj/.env.local");
    expect(markup).toContain("没有恢复点");
    expect(markup).toContain("新文件至少需要一个键");
    expect(markup).not.toContain("已有的键");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
  });
});

describe("the preview dialog", () => {
  const previewed = (preview: EnvEditPreview, phase: EditorState["phase"] = "previewed") =>
    render(stateOf({ phase, preview, entryEdits: { PORT: { mode: "set", value: "3001" } } }));

  it("lists each change, masks secrets and never shows the raw diff", () => {
    const markup = previewed(previewOf());

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("将修改现有文件");
    expect(markup).toContain("~/proj/.env");
    expect(markup).toContain("3000");
    expect(markup).toContain("3001");
    expect(markup).toContain("API_TOKEN");
    expect(markup).toContain("值已遮盖");
    expect(markup).toContain("秘密值不在预览中显示");
    expect(markup).toContain("（空值）");
    expect(markup).toContain("gone");
    expect(markup).toContain("值过长，未显示");
    expect(markup).toContain("完整文本差异不显示");
    expect(markup).toContain("写入前会先备份");
    expect(markup).toContain("到期时间");
    expect(markup).toContain("确认写入");
    expect(markup).toContain("data-dialog-cancel");
    expect(markup).not.toContain(SECRET_TEXT);
  });

  it("states that a new file is created without a recovery point", () => {
    const markup = previewed(
      previewOf({
        kind: "CREATE",
        recoveryPoint: "NONE_CREATED",
        currentHash: undefined,
        target: "~/proj/.env.local",
        matchesDefaultPatterns: false,
      }),
    );
    expect(markup).toContain("将创建新文件");
    expect(markup).toContain("确认创建");
    expect(markup).toContain("没有恢复点");
    expect(markup).toContain("不会伪造备份");
    expect(markup).toContain("默认扫描不会列出它");
  });

  it("flags a template name", () => {
    const markup = previewed(previewOf({ fileKind: "TEMPLATE" }));
    expect(markup).toContain("模板文件");
    expect(markup).toContain("不会与真实环境文件合并成运行时值");
  });

  it("disables both buttons and says so while writing", () => {
    const markup = previewed(previewOf(), "saving");
    expect(markup).toContain("正在写入并校验");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>返回修改<\/button>/);
    expect(markup).toContain('aria-busy="true"');
  });
});

describe("the save result", () => {
  const resultOf = (patch: Partial<SaveResult>): SaveResult => ({
    kind: "REPLACE",
    status: "SUCCEEDED",
    fileState: "WRITTEN",
    recoveryPoint: "BACKUP",
    backupId: "backup-123",
    ...patch,
  });
  const saved = (patch: Partial<SaveResult>) =>
    render(stateOf({ phase: "saved", result: resultOf(patch) }));

  it("reports a verified save with its backup", () => {
    const markup = saved({});
    expect(markup).toContain("已保存并通过读回校验");
    expect(markup).toContain("备份编号：backup-123");
    expect(markup).toContain("完成");
    expect(markup).not.toContain("返回继续编辑");
    expect(markup).not.toContain("预览改动");
  });

  it("reports a created file without inventing a backup", () => {
    const markup = saved({ kind: "CREATE", recoveryPoint: "NONE_CREATED", backupId: undefined });
    expect(markup).toContain("已创建并通过读回校验");
    expect(markup).toContain("无恢复点");
    expect(markup).not.toContain("备份编号");
  });

  it("reports a restored file and lets editing resume", () => {
    const markup = saved({
      status: "FAILED",
      fileState: "RESTORED",
      errorMessage: "写入后的读回校验未通过（键 PORT 读回后与预期不一致）。",
    });
    expect(markup).toContain("已恢复为原内容并核对");
    expect(markup).toContain("键 PORT 读回后与预期不一致");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("返回继续编辑");
  });

  it("does not offer to continue when the file state is uncertain", () => {
    const markup = saved({ status: "FAILED", fileState: "RESTORE_FAILED" });
    expect(markup).toContain("未能确认已恢复");
    expect(markup).toContain("备份仍保存着写入前的内容");
    expect(markup).not.toContain("返回继续编辑");
  });
});

describe("the page integration", () => {
  const baseProps: EnvironmentViewProps = {
    addingGrant: false,
    onAddGrant: () => undefined,
    onLoadValue: () => Promise.resolve("never"),
    onPatternsChange: () => undefined,
    onRecursiveChange: () => undefined,
    onReloadGrants: () => undefined,
    onRevokeGrant: () => undefined,
    onScan: () => undefined,
    onSelectFile: () => undefined,
    onSelectGrant: () => undefined,
    state: {
      ...INITIAL_ENVIRONMENT_STATE,
      grants: {
        status: "ready",
        grants: [
          { id: GRANT_ID, purpose: "CONFIG_DIRECTORY", kind: "DIRECTORY", displayPath: "~/proj", createdAtEpochMs: 1 },
        ],
      },
      selectedGrantId: GRANT_ID,
      scan: {
        status: "ready",
        requestId: 1,
        settings: { patterns: [".env"], recursive: false },
        outcome: {
          root: "~/proj",
          recursive: false,
          patterns: [".env"],
          files: [{ relativePath: ".env", name: ".env", kind: "ENVIRONMENT", sizeBytes: 5, oversized: false, symlink: false }],
          skipped: [],
          skippedTotal: 0,
          excludedDirectories: 0,
          partialReasons: [],
          entriesExamined: 1,
          limits: { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 },
          exclusions: [],
        },
      },
      selectedPath: ".env",
      file: {
        status: "loaded",
        requestId: 2,
        path: ".env",
        outcome: { status: "READY", file: FILE },
      },
    },
  };

  it("stays read-only without an editor", () => {
    const markup = renderToStaticMarkup(<EnvironmentView {...baseProps} />);
    expect(markup).toContain("文件内容（只读）");
    expect(markup).not.toContain("设置变量");
    expect(markup).not.toContain("新建环境文件");
  });

  it("offers editing the loaded file and creating a new one", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentView
        {...baseProps}
        onEditFile={() => undefined}
        onNewFile={() => undefined}
      />,
    );
    expect(markup).toContain("设置变量");
    expect(markup).toContain("新建环境文件…");
  });

  it("shows the editor in place of the file rows and locks file selection", () => {
    const state = stateOf({ entryEdits: { PORT: { mode: "set", value: "3001" } } });
    const markup = renderToStaticMarkup(
      <EnvironmentView
        {...baseProps}
        editor={{
          actions: ACTIONS,
          check: checkDrafts(EXISTING, state),
          state,
        }}
        onEditFile={() => undefined}
        onNewFile={() => undefined}
      />,
    );
    expect(markup).toContain("编辑环境文件");
    expect(markup).toContain("预览改动");
    expect(markup).not.toContain("文件内容（只读）");
    expect(markup).not.toContain("设置变量");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>新建环境文件…<\/button>/);
    expect(markup).toMatch(/<button[^>]*title="\.env"[^>]*disabled=""/);
  });

  it("marks the new-file button busy while the save panel is open", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentView {...baseProps} choosingNewFile onNewFile={() => undefined} />,
    );
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>等待选择…<\/button>/);
  });
});
