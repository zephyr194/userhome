import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ZshEditor, type ZshEditorActions } from "./ZshEditor";
import type { ZshEditorState } from "./zshEditorController";
import { SECRET_TEXT, emptyStateOf, previewOf, stateOf } from "./zshEditorFixtures";
import { EMPTY_DRAFTS, checkDrafts, draftsFor } from "./zshEditorModel";
import type { SaveResult } from "./dotenvEditorModel";

const ACTIONS: ZshEditorActions = {
  addPathItem: vi.fn(),
  addVariable: vi.fn(),
  cancelPreview: vi.fn(),
  close: vi.fn(),
  confirm: vi.fn(() => Promise.resolve()),
  disable: vi.fn(() => Promise.resolve()),
  enable: vi.fn(() => Promise.resolve()),
  movePathItem: vi.fn(),
  reload: vi.fn(() => Promise.resolve()),
  removePathItem: vi.fn(),
  removeVariable: vi.fn(),
  requestPreview: vi.fn(() => Promise.resolve()),
  resumeEditing: vi.fn(),
  setVariableMode: vi.fn(),
  setVariableValue: vi.fn(),
  updatePathItem: vi.fn(),
  updateVariable: vi.fn(),
};

function editorState(patch: Partial<ZshEditorState> = {}): ZshEditorState {
  const loaded = "loaded" in patch ? patch.loaded : stateOf();
  return {
    phase: "editing",
    target: { file: "ZSHRC" },
    ...(loaded === undefined ? {} : { loaded }),
    drafts: loaded === undefined ? EMPTY_DRAFTS : draftsFor(loaded, 1),
    nextId: 100,
    ...patch,
  };
}

function render(state: ZshEditorState): string {
  const check = state.loaded ? checkDrafts(state.loaded, state.drafts) : undefined;
  return renderToStaticMarkup(<ZshEditor actions={ACTIONS} check={check} state={state} />);
}

describe("loading and problems", () => {
  it("shows the file name and a loading state before anything is read", () => {
    const markup = render({
      phase: "loading",
      target: { file: "ZPROFILE" },
      drafts: EMPTY_DRAFTS,
      nextId: 1,
    });
    expect(markup).toContain(".zprofile");
    expect(markup).toContain("正在读取文件");
    expect(markup).toContain('aria-labelledby="zsh-editor-heading"');
    expect(markup).not.toMatch(/<input\b/);
  });

  it("explains why a file cannot be edited and only offers a reload where it helps", () => {
    const unavailable = render(
      editorState({ loaded: undefined, problem: { kind: "UNAVAILABLE", message: "读取文件时发生错误，请重试。" } }),
    );
    expect(unavailable).toContain("读取文件时发生错误");
    expect(unavailable).toContain("重新读取");
    const outside = render(
      editorState({ loaded: undefined, problem: { kind: "OUTSIDE_HOME", message: "解析到主目录之外，未读取、未跟随。" } }),
    );
    expect(outside).toContain("主目录之外");
    expect(outside).not.toContain("重新读取");
    expect(outside).not.toMatch(/<input\b/);
    expect(render(editorState({ loaded: undefined, problem: { kind: "NOT_LOCATED", message: "ZDOTDIR 未确定" } }))).toContain("注意：");
  });
});

describe("target, impact and authorization", () => {
  it("shows the full target path, the impact and the reading order", () => {
    const markup = render(editorState());
    expect(markup).toContain("/Users/me/.zshrc");
    expect(markup).toContain("仅交互 shell");
    expect(markup).toContain("第 6 位");
    expect(markup).toContain("专用块之外的内容永远不会被改写");
    expect(markup).toContain("已启用编辑");
    expect(markup).toContain("停用编辑");
    const env = render(
      editorState({
        target: { file: "ZSHENV" },
        loaded: stateOf({ file: "ZSHENV", name: ".zshenv", appliesTo: "ALL", position: 2, displayPath: "~/.zshenv", fullPath: "/Users/me/.zshenv" }),
      }),
    );
    expect(env).toContain(".zshenv");
    expect(env).toContain("所有 zsh");
    expect(env).toContain("影响面最大");
    expect(env).toContain("逐次选择");
  });

  it("says a missing file is created on save", () => {
    const markup = render(
      editorState({ loaded: emptyStateOf({ exists: false, contentHash: undefined }) }),
    );
    expect(markup).toContain("文件不存在，保存时创建");
  });

  it("asks to enable editing first and offers no field until then", () => {
    const markup = render(
      editorState({ loaded: stateOf({ enabled: false, grantId: undefined }) }),
    );
    expect(markup).toContain("启用编辑");
    expect(markup).toContain("这个具体文件");
    expect(markup).toContain("可以随时撤销");
    expect(markup).toContain("不会写入任何内容");
    expect(markup).toContain("/Users/me/.zshrc");
    expect(markup).not.toMatch(/<input\b/);
    expect(markup).not.toContain("预览改动");
    expect(markup).not.toContain("停用编辑");
    // The outside view stays available.
    expect(markup).toContain("块外的 PATH");
  });

  it("disables editing and says why when the block is damaged", () => {
    const markup = render(
      editorState({
        loaded: stateOf({
          block: { status: "BROKEN", kind: "DUPLICATE", line: 9, message: "第 9 行起存在第二个专用块。" },
        }),
      }),
    );
    expect(markup).toContain("第 9 行起存在第二个专用块");
    expect(markup).toContain("不会尝试修复");
    expect(markup).not.toMatch(/<input\b/);
    expect(markup).not.toContain("预览改动");
    expect(markup).toContain("块外的 PATH");
  });
});

describe("variables", () => {
  const markup = render(editorState());

  it("offers a field per variable, masks secrets and never prints a secret", () => {
    expect(markup).toContain("EDITOR 的值");
    expect(markup).toContain('value="vim"');
    expect(markup).toContain("API_TOKEN 的新值");
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*/);
    expect(markup).toContain("秘密不会显示");
    expect(markup).toContain("第 4 行");
    expect(markup).not.toContain(SECRET_TEXT);
    expect(markup).toContain("新增变量");
    expect(markup).toContain("单引号字面量");
  });

  it("shows which same-named assignment outside the block wins", () => {
    expect(markup).toContain("第 1 行在专用块之前已有同名赋值");
    expect(markup).toContain("不会被删除");
    expect(markup).toContain("块外同名");
  });

  it("masks the draft text of a secret variable and of a secret-looking new name", () => {
    const state = editorState({
      drafts: {
        variables: { API_TOKEN: { mode: "set", value: "typed-secret-123" } },
        additions: [
          { id: 7, name: "DB_PASSWORD", value: "another-secret" },
          { id: 8, name: "GOPATH", value: "/Users/me/go" },
        ],
        path: [],
      },
    });
    const rendered = render(state);
    // Secret fields are password inputs: the page shows no readable text for them
    // (the controller keeps the text only in memory and never in the browser).
    const secretInputs = rendered.match(/<input[^>]*type="password"[^>]*>/g) ?? [];
    expect(secretInputs).toHaveLength(2);
    expect(rendered).toContain("新增第 1 行的变量名");
    expect(rendered).toContain("变量名像秘密，输入已遮盖");
    expect(rendered).toContain('value="/Users/me/go"');
    expect(rendered).toContain("移除新增第 2 行");
  });

  it("marks variables to delete and shows per-field problems", () => {
    const rendered = render(
      editorState({
        drafts: {
          variables: {
            EDITOR: { mode: "remove", value: "" },
            API_TOKEN: { mode: "set", value: "a\nb" },
          },
          additions: [{ id: 3, name: "1BAD", value: "x" }],
          path: [],
        },
      }),
    );
    expect(rendered).toContain("将删除");
    expect(rendered).toContain("撤销删除 EDITOR");
    expect(rendered).toContain('aria-pressed="true"');
    expect(rendered).toContain("变量名必须匹配");
    expect(rendered).toContain("含换行、制表符或其他控制");
    expect(rendered).toContain("请先修正标红的字段");
  });

  it("explains an over-long value that cannot be edited here", () => {
    const rendered = render(
      editorState({
        loaded: stateOf({
          block: {
            status: "PRESENT",
            beginLine: 1,
            endLine: 4,
            variables: [{ name: "BIG", line: 2, secret: false, hasValue: true, valueLength: 5000 }],
            path: [],
          },
        }),
      }),
    );
    expect(rendered).toContain("不可修改");
    expect(rendered).toContain("超过 4096 个字符");
  });
});

describe("the PATH list", () => {
  const markup = render(editorState());

  it("lists the items in priority order with keyboard-reachable move and delete buttons", () => {
    expect(markup).toContain('aria-label="专用块的 PATH 项（优先级由高到低）"');
    expect(markup).toContain("PATH 第 1 项");
    expect(markup).toContain('value="/opt/tool/bin"');
    expect(markup).toContain('value="$HOME/bin"');
    for (const label of ["上移 PATH 第 1 项", "下移 PATH 第 1 项", "删除 PATH 第 1 项", "上移 PATH 第 2 项", "下移 PATH 第 2 项", "删除 PATH 第 2 项"]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    // No drag-only affordance: ordering is done with buttons.
    expect(markup).toContain("用“上移／下移”按钮调整顺序，不需要拖拽");
    expect(markup).not.toContain("draggable");
    // The ends cannot move further.
    expect(markup).toMatch(/<button[^>]*aria-label="上移 PATH 第 1 项"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="上移 PATH 第 1 项"/);
    expect(markup).toMatch(/<button[^>]*aria-label="下移 PATH 第 2 项"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="下移 PATH 第 2 项"/);
    expect(markup).not.toMatch(/<button[^>]*aria-label="下移 PATH 第 1 项"[^>]*disabled=""/);
    expect(markup).toContain("新增 PATH 项");
  });

  it("explains the form that is written and that the existing PATH is kept", () => {
    expect(markup).toContain("原有 PATH 完整保留");
    expect(markup).toContain("export path=");
    expect(markup).toContain("空项表示当前目录");
    expect(markup).toContain("其后固定接着原有的");
  });

  it("flags duplicates, items already outside and bad items", () => {
    const loaded = stateOf();
    const rendered = render(
      editorState({
        drafts: {
          variables: {},
          additions: [],
          path: [
            { id: 1, text: "/a" },
            { id: 2, text: "/a" },
            { id: 3, text: "/opt/static/bin" },
            { id: 4, text: "relative/bin" },
          ],
        },
        loaded,
      }),
    );
    expect(rendered).toContain("重复项");
    expect(rendered).toContain("块外第 11 行已有");
    expect(rendered).toContain("必须是绝对路径");
  });

  it("starts empty with a hint, and shows the list for a file with no block", () => {
    const empty = render(editorState({ loaded: emptyStateOf() }));
    expect(empty).toContain("专用块里还没有 PATH 项");
    expect(empty).toContain("专用块里还没有变量");
    expect(empty).toContain("专用块之外没有 PATH 设置");
  });
});

describe("outside the block", () => {
  const markup = render(editorState());

  it("shows outside PATH lines as written, flags dynamic ones and never expands them", () => {
    expect(markup).toContain("块外的 PATH（只读）");
    expect(markup).toContain("不展开、不覆盖、不据猜测值改写");
    expect(markup).toContain("$(brew --prefix)/bin");
    expect(markup).toContain("$PATH");
    expect(markup).toContain("命令替换");
    expect(markup).toContain("动态／未解析");
    expect(markup).toContain("if x; then PATH=y; fi");
    expect(markup).toContain("/opt/static/bin");
    expect(markup).toContain("在专用块之前");
    expect(markup).toContain("在专用块之后");
  });

  it("withholds secret-looking dynamic lines", () => {
    const rendered = render(
      editorState({
        loaded: stateOf({
          outside: {
            variables: [],
            path: [],
            dynamicPathLines: [{ line: 3, beforeBlock: true, text: undefined, withheld: true }],
            truncated: true,
          },
        }),
      }),
    );
    expect(rendered).toContain("疑似含秘密，内容已隐藏");
    expect(rendered).toContain("只显示了一部分");
  });
});

describe("the preview dialog", () => {
  const previewed = (patch: Partial<ReturnType<typeof previewOf>> = {}, phase: ZshEditorState["phase"] = "previewed") =>
    render(editorState({ phase, preview: previewOf(patch) }));

  it("shows the full target, the impact, the changes, the managed-line diff and the warnings", () => {
    const markup = previewed({
      variableChanges: [
        { name: "EDITOR", change: "MODIFY", secret: false, before: "vim", after: "nvim", omitted: false },
        { name: "API_TOKEN", change: "MODIFY", secret: true, omitted: false },
        { name: "NEW_ONE", change: "ADD", secret: false, after: "", omitted: false },
        { name: "OLD", change: "REMOVE", secret: false, before: "gone", omitted: false },
        { name: "LONG", change: "ADD", secret: false, omitted: true },
      ],
      pathChange: { before: ["/a"], after: ["$HOME/bin", "/a"] },
      blockDiff: [
        { kind: "REMOVED", text: "export EDITOR='vim'" },
        { kind: "ADDED", text: "export EDITOR='nvim'" },
        { kind: "ADDED", text: "export API_TOKEN='••••••'" },
      ],
      warnings: [
        { kind: "OVERRIDDEN_BY_LATER_ASSIGNMENT", name: "LANG", line: 10 },
        { kind: "DYNAMIC_PATH_OUTSIDE", line: 2 },
        { kind: "BLOCK_APPENDED" },
      ],
    });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("将修改文件中的专用块");
    expect(markup).toContain("/Users/me/.zshrc");
    expect(markup).toContain("仅交互 shell");
    expect(markup).toContain("第 6 位");
    expect(markup).toContain("vim");
    expect(markup).toContain("nvim");
    expect(markup).toContain("值已遮盖");
    expect(markup).toContain("秘密值不在预览中显示");
    expect(markup).toContain("（空值）");
    expect(markup).toContain("gone");
    expect(markup).toContain("值过长，未显示");
    expect(markup).toContain("$HOME/bin");
    expect(markup).toContain("改动前的 PATH 项");
    expect(markup).toContain("改动后的 PATH 项");
    expect(markup).toContain("专用块的行变化");
    expect(markup).toContain("export EDITOR=&#x27;nvim&#x27;");
    expect(markup).toContain("••••••");
    expect(markup).toContain("完整文本差异不显示");
    expect(markup).toContain("需要留意（3）");
    expect(markup).toContain("会覆盖专用块里的值");
    expect(markup).toContain("不展开、不改写");
    expect(markup).toContain("会在文件末尾追加一个");
    expect(markup).toContain("写入前会先备份");
    expect(markup).toContain("只修改了文件：不会 source");
    expect(markup).toContain("新开的终端");
    expect(markup).toContain("到期时间");
    expect(markup).toContain("确认写入");
    expect(markup).toContain("data-dialog-cancel");
    expect(markup).not.toContain(SECRET_TEXT);
  });

  it("states that a new file is created without a recovery point", () => {
    const markup = previewed({
      kind: "CREATE",
      recoveryPoint: "NONE_CREATED",
      currentHash: undefined,
      createdBlock: true,
      warnings: [{ kind: "FILE_CREATED" }, { kind: "BLOCK_APPENDED" }],
    });
    expect(markup).toContain("将创建新文件，并写入专用块");
    expect(markup).toContain("确认创建");
    expect(markup).toContain("没有恢复点");
    expect(markup).toContain("不会伪造备份");
    expect(markup).toContain("仅所有者可读写");
  });

  it("titles an appended block and shows no warnings section when there are none", () => {
    const appended = previewed({ createdBlock: true, warnings: [] });
    expect(appended).toContain("将在文件末尾追加专用块");
    expect(appended).not.toContain("需要留意");
  });

  it("disables both buttons and says so while writing", () => {
    const markup = previewed({}, "saving");
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
    render(editorState({ phase: "saved", result: resultOf(patch) }));

  it("claims only new shells after a success and never a running process", () => {
    const markup = saved({});
    expect(markup).toContain("已保存并通过读回校验");
    expect(markup).toContain("备份编号：backup-123");
    expect(markup).toContain("仅对之后新开的终端");
    expect(markup).toContain("不影响正在运行的进程");
    expect(markup).toContain("不会 source");
    expect(markup).not.toMatch(/立即生效|已生效|已更新当前|当前终端已/);
    expect(markup).toContain("完成");
    expect(markup).not.toContain("返回继续编辑");
    expect(markup).not.toContain("预览改动");
  });

  it("reports a created file without a recovery point and omits the note on failures", () => {
    const created = saved({ kind: "CREATE", recoveryPoint: "NONE_CREATED", backupId: undefined });
    expect(created).toContain("新文件，无恢复点");
    expect(created).not.toContain("备份编号");
    const failed = saved({ status: "FAILED", fileState: "RESTORED", errorMessage: "读回校验未通过" });
    expect(failed).toContain("已恢复为原内容并核对");
    expect(failed).toContain("原因：读回校验未通过");
    expect(failed).toContain("返回继续编辑");
    expect(failed).not.toContain("仅对之后新开的终端");
  });

  it("does not offer to continue when the file may hold the new content", () => {
    const markup = saved({ status: "FAILED", fileState: "RESTORE_FAILED" });
    expect(markup).toContain("可能含有新内容");
    expect(markup).toContain("备份仍保存着写入前的内容");
    expect(markup).not.toContain("返回继续编辑");
  });
});

describe("accessibility and theming", () => {
  const markup = render(editorState());

  it("uses labelled regions and native, labelled controls", () => {
    for (const id of [
      "zsh-editor-heading",
      "zsh-editor-target-heading",
      "zsh-editor-variables-heading",
      "zsh-editor-path-heading",
      "zsh-editor-outside-heading",
    ]) {
      expect(markup).toContain(`aria-labelledby="${id}"`);
    }
    expect(markup).toContain("<button");
    expect(markup).toContain("返回只读视图");
    expect(markup).toContain("取消编辑");
  });

  it("styles with theme tokens only, so light and dark both work", () => {
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\b(bg|text|border)-(white|black|gray|slate|zinc|red|green|blue|yellow)-\d/);
    expect(markup).toContain("bg-surface-muted");
    expect(markup).toContain("text-muted-foreground");
  });

  it("keeps the preview button disabled until there is a valid change", () => {
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
    expect(markup).toContain("还没有改动");
    const changed = render(
      editorState({
        drafts: {
          ...draftsFor(stateOf(), 1),
          variables: { EDITOR: { mode: "set", value: "nvim" } },
        },
      }),
    );
    expect(changed).not.toMatch(/<button[^>]*disabled=""[^>]*>预览改动<\/button>/);
  });
});
