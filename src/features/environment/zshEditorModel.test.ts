import { describe, expect, it } from "vitest";
import type { ZshEditWarning } from "../../ipc/environment";
import { emptyStateOf, stateOf } from "./zshEditorFixtures";
import {
  EMPTY_DRAFTS,
  NOT_ENABLED_TEXT,
  PATH_FORM_NOTE,
  VALUE_FORM_NOTE,
  ZSH_EFFECT_NOTE,
  checkDrafts,
  draftsFor,
  editAvailability,
  fileImpact,
  nameProblem,
  normalizePathItem,
  outsideConflicts,
  previewKindText,
  valueProblem,
  variableEditability,
  warningText,
  type ZshDrafts,
} from "./zshEditorModel";

function drafts(patch: Partial<ZshDrafts> = {}): ZshDrafts {
  return { ...draftsFor(stateOf(), 100), ...patch };
}

describe("field checks", () => {
  it("accepts valid names and refuses invalid and reserved ones", () => {
    expect(nameProblem("_ok1")).toBeUndefined();
    expect(nameProblem("A".repeat(255))).toBeUndefined();
    for (const name of ["", "1A", "A-B", "A B", "A=1", "$(x)", "é", "A".repeat(256)]) {
      expect(nameProblem(name), JSON.stringify(name)).toBeDefined();
    }
    expect(nameProblem("PATH")).toMatch(/PATH 列表/);
    expect(nameProblem("path")).toMatch(/PATH 列表/);
  });

  it("refuses values that are not one safe line and counts characters", () => {
    for (const value of ["a\nb", "a\rb", "a\0b", "a\tb", "\u001b[0m", "x\u202ey", "a\u2028b", "z\u200bw", "b\ufeffc"]) {
      expect(valueProblem(value), JSON.stringify(value)).toMatch(/控制/);
    }
    // Hostile-looking text is fine: it is stored as a literal.
    for (const value of ["it's", "$(x)", "`x`", "a;b&c|d", "\\", "-n", "", "日本語 😀", "$HOME", "'; rm -rf /"]) {
      expect(valueProblem(value), JSON.stringify(value)).toBeUndefined();
    }
    expect(valueProblem("é".repeat(8192))).toBeUndefined();
    expect(valueProblem("é".repeat(8193))).toMatch(/8192/);
    expect(valueProblem("😀".repeat(8192))).toBeUndefined();
  });

  it("normalizes PATH items the way the backend stores them", () => {
    const ok = (raw: string) => {
      const result = normalizePathItem(raw);
      return result.ok ? result.item : result.problem;
    };
    expect(ok("/usr/local/bin")).toBe("/usr/local/bin");
    expect(ok("/opt/my tool/it's")).toBe("/opt/my tool/it's");
    expect(ok("~")).toBe("$HOME");
    expect(ok("~/bin")).toBe("$HOME/bin");
    expect(ok("$HOME")).toBe("$HOME");
    expect(ok("$HOME/.local/bin")).toBe("$HOME/.local/bin");
    expect(ok("${HOME}/go/bin")).toBe("$HOME/go/bin");
    for (const raw of ["", "a:b", " /a", "/a ", "/a\nb", "relative", ".", "./x", "..", "~user/x", "$HOMEX/y", "$PATH", "$(pwd)", "`pwd`", `/${"a".repeat(1024)}`]) {
      expect(normalizePathItem(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe("availability", () => {
  it("separates ready, not enabled and a damaged block", () => {
    expect(editAvailability(stateOf())).toEqual({ kind: "ready" });
    expect(editAvailability(stateOf({ enabled: false, grantId: undefined }))).toEqual({
      kind: "needs-enable",
    });
    const blocked = editAvailability(
      stateOf({
        block: { status: "BROKEN", kind: "DUPLICATE", line: 9, message: "第 9 行起存在第二个专用块。" },
      }),
    );
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind === "blocked") {
      expect(blocked.reason).toContain("第 9 行起存在第二个专用块");
      expect(blocked.reason).toContain("不会尝试修复");
    }
    // A damaged block wins over a missing authorization: it cannot be edited either way.
    expect(
      editAvailability(
        stateOf({
          enabled: false,
          grantId: undefined,
          block: { status: "BROKEN", kind: "NESTED", line: 2, message: "嵌套" },
        }),
      ).kind,
    ).toBe("blocked");
  });

  it("explains variables that cannot be changed", () => {
    expect(
      variableEditability({ name: "A", line: 1, secret: false, hasValue: true, valueLength: 5000 }),
    ).toEqual({ ok: false, reason: expect.stringContaining("4096") });
    expect(
      variableEditability({ name: "A", line: 1, secret: true, hasValue: true, valueLength: 5000 }),
    ).toEqual({ ok: true });
    expect(
      variableEditability({ name: "A", line: 1, secret: false, hasValue: false, valueLength: 0 }),
    ).toEqual({ ok: true });
  });
});

describe("checking drafts", () => {
  it("starts with the block's PATH as drafts and nothing to save", () => {
    const initial = draftsFor(stateOf(), 10);
    expect(initial.path.map((item) => [item.id, item.text])).toEqual([
      [10, "/opt/tool/bin"],
      [11, "$HOME/bin"],
    ]);
    const check = checkDrafts(stateOf(), initial);
    expect(check.ready).toBe(false);
    expect(check.edit).toBeUndefined();
    expect(check.changeCount).toBe(0);
    expect(check.pathChanged).toBe(false);
    expect(draftsFor(emptyStateOf(), 1).path).toEqual([]);
    expect(checkDrafts(emptyStateOf(), EMPTY_DRAFTS).ready).toBe(false);
  });

  it("turns changed variables into SET and REMOVE edits and skips unchanged ones", () => {
    const check = checkDrafts(
      stateOf(),
      drafts({
        variables: {
          EDITOR: { mode: "set", value: "nvim" },
          API_TOKEN: { mode: "remove", value: "" },
        },
      }),
    );
    expect(check.ready).toBe(true);
    expect(check.edit).toEqual({
      variables: [
        { op: "SET", name: "EDITOR", value: "nvim" },
        { op: "REMOVE", name: "API_TOKEN" },
      ],
    });
    // The same value, or an empty replacement for a secret, is no change.
    const same = checkDrafts(
      stateOf(),
      drafts({
        variables: {
          EDITOR: { mode: "set", value: "vim" },
          API_TOKEN: { mode: "set", value: "" },
        },
      }),
    );
    expect(same.ready).toBe(false);
    expect(same.changeCount).toBe(0);
    const secret = checkDrafts(
      stateOf(),
      drafts({ variables: { API_TOKEN: { mode: "set", value: "new-secret" } } }),
    );
    expect(secret.edit?.variables).toEqual([{ op: "SET", name: "API_TOKEN", value: "new-secret" }]);
  });

  it("reports value problems per field and sends nothing while one exists", () => {
    const check = checkDrafts(
      stateOf(),
      drafts({
        variables: {
          EDITOR: { mode: "set", value: "a\nb" },
          GONE: { mode: "remove", value: "" },
        },
        additions: [{ id: 1, name: "OK", value: "1" }],
      }),
    );
    expect(check.ready).toBe(false);
    expect(check.edit).toBeUndefined();
    expect(check.problems.variables.EDITOR).toMatch(/控制/);
    expect(check.problems.variables.GONE).toMatch(/没有这个变量/);
  });

  it("checks additions: names, duplicates, existing names and values", () => {
    const check = checkDrafts(
      stateOf(),
      drafts({
        additions: [
          { id: 1, name: "", value: "x" },
          { id: 2, name: "1BAD", value: "x" },
          { id: 3, name: "PATH", value: "x" },
          { id: 4, name: "EDITOR", value: "x" },
          { id: 5, name: "DUP", value: "x" },
          { id: 6, name: "DUP", value: "y" },
          { id: 7, name: "FINE", value: "tab\there" },
          { id: 8, name: "GOOD", value: "ok" },
        ],
      }),
    );
    expect(Object.keys(check.problems.additions).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(check.problems.additions[3]).toMatch(/PATH 列表/);
    expect(check.problems.additions[4]).toMatch(/已在专用块内/);
    expect(check.problems.additions[5]).toMatch(/重复/);
    expect(check.problems.additions[8]).toBeUndefined();
    expect(check.ready).toBe(false);
    const clean = checkDrafts(
      stateOf(),
      drafts({ additions: [{ id: 1, name: "GOPATH", value: "/Users/me/go" }] }),
    );
    expect(clean.edit?.variables).toEqual([{ op: "SET", name: "GOPATH", value: "/Users/me/go" }]);
  });

  it("limits the managed variables to 128", () => {
    const many = Array.from({ length: 127 }, (_, index) => ({
      id: index + 1,
      name: `V${index}`,
      value: "1",
    }));
    // 2 existing + 127 additions = 129
    const check = checkDrafts(stateOf(), drafts({ additions: many }));
    expect(check.ready).toBe(false);
    expect(check.problems.additions[1]).toMatch(/128/);
    const removing = checkDrafts(
      stateOf(),
      drafts({
        additions: many,
        variables: { EDITOR: { mode: "remove", value: "" } },
      }),
    );
    expect(removing.problems.additions[1]).toBeUndefined();
  });

  it("sends the whole PATH list only when it differs from the block", () => {
    const initial = draftsFor(stateOf(), 10);
    const [first, second] = initial.path;
    if (first === undefined || second === undefined) throw new Error("fixture");
    const reordered = checkDrafts(stateOf(), { ...initial, path: [second, first] });
    expect(reordered.pathChanged).toBe(true);
    expect(reordered.edit).toEqual({ variables: [], path: ["$HOME/bin", "/opt/tool/bin"] });
    const typed = checkDrafts(stateOf(), {
      ...initial,
      path: [{ id: 10, text: "/opt/tool/bin" }, { id: 11, text: "~/bin" }],
    });
    // `~/bin` is the stored `$HOME/bin`: no change.
    expect(typed.pathChanged).toBe(false);
    expect(typed.ready).toBe(false);
    const cleared = checkDrafts(stateOf(), { ...initial, path: [] });
    expect(cleared.edit).toEqual({ variables: [], path: [] });
    const added = checkDrafts(emptyStateOf(), {
      ...EMPTY_DRAFTS,
      path: [{ id: 1, text: "~/.local/bin" }, { id: 2, text: "/opt/a" }],
    });
    expect(added.edit).toEqual({ variables: [], path: ["$HOME/.local/bin", "/opt/a"] });
  });

  it("flags bad PATH items by id and sends nothing", () => {
    const check = checkDrafts(emptyStateOf(), {
      ...EMPTY_DRAFTS,
      path: [
        { id: 1, text: "/ok" },
        { id: 2, text: "" },
        { id: 3, text: "relative/bin" },
        { id: 4, text: "/a:/b" },
      ],
    });
    expect(Object.keys(check.problems.path).map(Number)).toEqual([2, 3, 4]);
    expect(check.problems.path[2]).toMatch(/当前目录/);
    expect(check.edit).toBeUndefined();
    expect(check.ready).toBe(false);
    expect(check.pathChanged).toBe(false);
    const tooMany = checkDrafts(emptyStateOf(), {
      ...EMPTY_DRAFTS,
      path: Array.from({ length: 65 }, (_, index) => ({ id: index + 1, text: `/p${index}` })),
    });
    expect(tooMany.problems.path[65]).toMatch(/64/);
    expect(tooMany.ready).toBe(false);
  });

  it("marks duplicates inside the list and items already in a static outside PATH", () => {
    const check = checkDrafts(stateOf(), {
      ...EMPTY_DRAFTS,
      path: [
        { id: 1, text: "/a" },
        { id: 2, text: "/opt/static/bin" },
        { id: 3, text: "/a" },
        { id: 4, text: "$(brew --prefix)/bin" },
      ],
    });
    expect(check.pathMarks[1]).toEqual({ duplicate: true });
    expect(check.pathMarks[3]).toEqual({ duplicate: true });
    expect(check.pathMarks[2]).toEqual({ duplicate: false, outsideLine: 11 });
    // A dynamic outside item is never compared, and the bad item has no mark.
    expect(check.pathMarks[4]).toBeUndefined();
    // Duplicates are shown, not blocked.
    const dup = checkDrafts(emptyStateOf(), {
      ...EMPTY_DRAFTS,
      path: [{ id: 1, text: "/a" }, { id: 2, text: "/a" }],
    });
    expect(dup.ready).toBe(true);
  });

  it("combines variable and PATH changes in one edit", () => {
    const check = checkDrafts(
      stateOf(),
      drafts({
        variables: { EDITOR: { mode: "set", value: "nvim" } },
        path: [{ id: 1, text: "/only" }],
      }),
    );
    expect(check.changeCount).toBe(2);
    expect(check.edit).toEqual({
      variables: [{ op: "SET", name: "EDITOR", value: "nvim" }],
      path: ["/only"],
    });
  });
});

describe("outside conflicts and wording", () => {
  it("says who wins for a same-named assignment outside the block", () => {
    const state = stateOf();
    const [before] = outsideConflicts(state, "EDITOR");
    expect(before?.beforeBlock).toBe(true);
    expect(before?.text).toContain("第 1 行");
    expect(before?.text).toContain("不会被删除");
    expect(before?.text).toContain("会覆盖它");
    const [after] = outsideConflicts(state, "LANG");
    expect(after?.beforeBlock).toBe(false);
    expect(after?.text).toContain("会覆盖专用块里的值");
    expect(outsideConflicts(state, "NOPE")).toEqual([]);
  });

  it("describes the impact of each startup file and its place in the order", () => {
    const rc = fileImpact(stateOf());
    expect(rc.label).toBe("仅交互 shell");
    expect(rc.order).toContain("第 6 位");
    const env = fileImpact(stateOf({ file: "ZSHENV", appliesTo: "ALL", position: 2 }));
    expect(env.label).toBe("所有 zsh");
    expect(env.detail).toContain("影响面最大");
    expect(fileImpact(stateOf({ file: "ZPROFILE", appliesTo: "LOGIN", position: 4 })).detail).toContain("登录 shell");
    expect(fileImpact(stateOf({ file: "ZLOGIN", appliesTo: "LOGIN", position: 8 })).detail).toContain(".zshrc 之后");
  });

  it("words every warning without a value and only claims what the backend does", () => {
    const warnings: ZshEditWarning[] = [
      { kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "A", line: 1 },
      { kind: "OVERRIDDEN_BY_LATER_ASSIGNMENT", name: "B", line: 9 },
      { kind: "DUPLICATE_PATH_ITEM", item: "/a" },
      { kind: "PATH_ITEM_ALSO_OUTSIDE", item: "/a", line: 3 },
      { kind: "DYNAMIC_PATH_OUTSIDE", line: 4 },
      { kind: "LATER_PATH_ASSIGNMENT", line: 5 },
      { kind: "BLOCK_APPENDED" },
      { kind: "FILE_CREATED" },
    ];
    const texts = warnings.map(warningText);
    expect(new Set(texts).size).toBe(warnings.length);
    expect(texts[1]).toContain("覆盖专用块里的值");
    expect(texts[4]).toContain("不展开、不改写");
    expect(texts[6]).toContain("每个字节保持不变");
    expect(texts[7]).toContain("没有恢复点");
  });

  it("keeps the effect wording to new shells only", () => {
    expect(ZSH_EFFECT_NOTE).toContain("新开的终端");
    expect(ZSH_EFFECT_NOTE).toContain("不会 source");
    expect(ZSH_EFFECT_NOTE).toContain("不影响正在运行的进程");
    for (const text of [ZSH_EFFECT_NOTE, NOT_ENABLED_TEXT, PATH_FORM_NOTE, VALUE_FORM_NOTE]) {
      expect(text).not.toMatch(/立即生效|已生效|当前会话已|自动 source/);
    }
    expect(PATH_FORM_NOTE).toContain("原有 PATH 完整保留");
    expect(PATH_FORM_NOTE).toContain("空项");
    expect(VALUE_FORM_NOTE).toContain("'\\''");
  });

  it("titles the preview by what will happen to the file", () => {
    expect(previewKindText({ kind: "CREATE", createdBlock: true })).toContain("创建新文件");
    expect(previewKindText({ kind: "REPLACE", createdBlock: true })).toContain("末尾追加");
    expect(previewKindText({ kind: "REPLACE", createdBlock: false })).toContain("修改");
  });
});

describe("sensitive variable warning wording", () => {
  it("names the variable, warns about the risk and shows no value", () => {
    const text = warningText({ kind: "SENSITIVE_VARIABLE", name: "DYLD_INSERT_LIBRARIES" });
    expect(text).toContain("DYLD_INSERT_LIBRARIES");
    expect(text).toContain("风险");
    expect(text).toContain("仍可保存");
    const other = warningText({ kind: "SENSITIVE_VARIABLE", name: "IFS" });
    expect(other).not.toBe(text);
  });
});
