// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import { ZshView, type ZshViewProps } from "./ZshView";
import { INITIAL_ZSH_STATE, type ZshState } from "./zshModel";

afterEach(() => cleanup());

const ORDER: ZshOrderStep[] = [
  { position: 2, scope: "USER", pathLabel: "~/.zshenv", appliesTo: "ALL", file: "ZSHENV", readByUserHome: true },
  { position: 4, scope: "USER", pathLabel: "~/.zprofile", appliesTo: "LOGIN", file: "ZPROFILE", readByUserHome: true },
  { position: 6, scope: "USER", pathLabel: "~/.zshrc", appliesTo: "INTERACTIVE", file: "ZSHRC", readByUserHome: true },
  { position: 8, scope: "USER", pathLabel: "~/.zlogin", appliesTo: "LOGIN", file: "ZLOGIN", readByUserHome: true },
];
const NAMES = { ZSHENV: ".zshenv", ZPROFILE: ".zprofile", ZSHRC: ".zshrc", ZLOGIN: ".zlogin" } as const;
const APPLIES = { ZSHENV: "ALL", ZPROFILE: "LOGIN", ZSHRC: "INTERACTIVE", ZLOGIN: "LOGIN" } as const;
const POSITIONS = { ZSHENV: 2, ZPROFILE: 4, ZSHRC: 6, ZLOGIN: 8 } as const;

function entry(overrides: Partial<ZshEntryRow> & { line: number; name: string }): ZshEntryRow {
  return {
    kind: "ENTRY",
    endLine: overrides.line,
    exported: true,
    operation: "SET",
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    state: "STATIC",
    ...overrides,
  };
}

function ready(rows: ZshRow[]): ZshFile["outcome"] {
  const entries = rows.filter((row): row is ZshEntryRow => row.kind === "ENTRY");
  return {
    status: "READY",
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: entries.length,
    secretCount: 0,
    dynamicCount: entries.filter((row) => row.state === "DYNAMIC").length,
    unrecognizedCount: 0,
  };
}

function file(key: ZshFileKey, outcome: ZshFile["outcome"]): ZshFile {
  return {
    file: key,
    name: NAMES[key],
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    displayPath: `~/${NAMES[key]}`,
    outcome,
  };
}

function stateOf(files: ZshFile[]): ZshState {
  const overview: ZshOverview = {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: ORDER,
    zdotdir: { status: "DEFAULT" },
    files,
  };
  return { ...INITIAL_ZSH_STATE, load: { status: "ready", requestId: 1, overview } };
}

const FILES = [
  file("ZSHENV", ready([entry({ line: 1, name: "EDITOR", value: "vim" })])),
  file("ZSHRC", ready([entry({ line: 3, name: "EDITOR", value: "code" })])),
];

function renderView(state: ZshState, overrides: Partial<ZshViewProps> = {}) {
  return render(
    <ZshView
      choosing={false}
      onChooseDirectory={() => undefined}
      onClearDirectory={() => undefined}
      onLoadValue={() => Promise.resolve("never")}
      onReload={() => undefined}
      state={state}
      {...overrides}
    />,
  );
}

function variableList(): HTMLElement {
  return screen.getByRole("region", { name: "zsh 变量的最终值与过程值" });
}

function detail(): HTMLElement {
  return screen.getByRole("region", { name: "选中变量的详情" });
}

function rowsNamed(name: string): HTMLElement[] {
  return within(variableList())
    .getAllByRole("button")
    .filter((candidate) => candidate.querySelector("code")?.textContent === name);
}

function selectRow(name: string, index = 0) {
  const button = rowsNamed(name)[index];
  if (!button) throw new Error(`no variable row for ${name}`);
  fireEvent.click(button);
}

describe("zsh list: a name assigned in more than one file", () => {
  it("shows one row per scope when the final values differ, each with its shells", () => {
    renderView(stateOf(FILES));
    expect(rowsNamed("EDITOR")).toHaveLength(2);
    expect(within(detail()).getByText("vim")).toBeTruthy();
    expect(within(detail()).getByText("所有 zsh")).toBeTruthy();
    selectRow("EDITOR", 1);
    expect(within(detail()).getByText("code")).toBeTruthy();
    expect(within(detail()).getByText("仅交互 shell")).toBeTruthy();
  });

  it("keeps the earlier value of the narrower row as a process value, listed in reading order", () => {
    renderView(stateOf(FILES));
    selectRow("EDITOR", 1);
    const steps = within(screen.getByRole("list", { name: "EDITOR 的读取顺序" }));
    expect(steps.getByText(".zshenv:1")).toBeTruthy();
    expect(steps.getByText("vim")).toBeTruthy();
    expect(within(detail()).getByText("code")).toBeTruthy();
    expect(within(detail()).getByText("最终生效值")).toBeTruthy();
  });

  it("gives a same-scope replacement one row, with the earlier value as its process value", () => {
    renderView(
      stateOf([
        file("ZPROFILE", ready([entry({ line: 1, name: "EDITOR", value: "vim" })])),
        file("ZLOGIN", ready([entry({ line: 3, name: "EDITOR", value: "code" })])),
      ]),
    );
    expect(rowsNamed("EDITOR")).toHaveLength(1);
    selectRow("EDITOR");
    expect(within(detail()).getByText("code")).toBeTruthy();
    const steps = within(screen.getByRole("list", { name: "EDITOR 的读取顺序" }));
    expect(steps.getByText(".zprofile:1")).toBeTruthy();
    expect(steps.getByText("vim")).toBeTruthy();
  });

  it("keeps both rows when the last one appends, and marks the append", () => {
    renderView(
      stateOf([
        file("ZSHENV", ready([entry({ line: 1, name: "PATH", value: "/usr/bin" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "PATH", operation: "APPEND", value: "/opt/bin" })])),
      ]),
    );
    expect(rowsNamed("PATH")).toHaveLength(2);
    selectRow("PATH", 0);
    expect(within(detail()).getByText("/usr/bin")).toBeTruthy();
    selectRow("PATH", 1);
    expect(within(detail()).getByText("/opt/bin")).toBeTruthy();
    expect(within(detail()).getByText("追加")).toBeTruthy();
  });

  it("no longer shows the separate same-name section", () => {
    renderView(stateOf(FILES));
    expect(screen.queryByText("同名项对照")).toBeNull();
  });
});

describe("zsh view: references are expanded from earlier assignments", () => {
  it("shows the expanded value as final, with the written value noted", () => {
    renderView(
      stateOf([
        file("ZSHENV", ready([entry({ line: 1, name: "BASE", value: "/opt" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "BIN", value: "$BASE/bin", state: "REFERENCE" })])),
      ]),
    );
    selectRow("BIN");
    expect(within(detail()).getByText("/opt/bin")).toBeTruthy();
    expect(within(detail()).getByText("由原文 $BASE/bin 展开得到")).toBeTruthy();
  });

  it("shows a reference with no earlier assignment as written, and says why", () => {
    renderView(
      stateOf([
        file("ZSHENV", ready([entry({ line: 1, name: "BIN", value: "$HOME/bin", state: "REFERENCE" })])),
      ]),
    );
    selectRow("BIN");
    expect(within(detail()).getByText("$HOME/bin")).toBeTruthy();
    expect(within(detail()).getByText(/引用的 HOME 在它之前没有可确定的赋值，无法算出结果/)).toBeTruthy();
  });
});

describe("zsh view: variable actions", () => {
  it("opens the managed block of .zshrc with a new variable from 设置变量", () => {
    const onEditFile = vi.fn();
    renderView(stateOf(FILES), { onEditFile });
    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    expect(onEditFile).toHaveBeenCalledWith("ZSHRC", { kind: "addition" });
  });

  it("opens the file and line of the assignment the selected row belongs to", () => {
    const onEditFile = vi.fn();
    renderView(stateOf(FILES), { onEditFile });
    selectRow("EDITOR", 1);
    fireEvent.click(within(detail()).getByRole("button", { name: "修改 EDITOR" }));
    expect(onEditFile).toHaveBeenLastCalledWith("ZSHRC", { kind: "variable", name: "EDITOR", line: 3 });
    selectRow("EDITOR", 0);
    fireEvent.click(within(detail()).getByRole("button", { name: "修改 EDITOR" }));
    expect(onEditFile).toHaveBeenLastCalledWith("ZSHENV", { kind: "variable", name: "EDITOR", line: 1 });
  });

  it("disables 设置变量 when .zshrc cannot be edited", () => {
    const onEditFile = vi.fn();
    renderView(
      stateOf([
        file("ZSHENV", ready([])),
        { ...file("ZSHRC", { status: "OUTSIDE_HOME", message: "越界，未读取。" }) },
      ]),
      { onEditFile },
    );
    const button = screen.getByRole("button", { name: "设置变量" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("offers no edit actions without an editor", () => {
    renderView(stateOf(FILES));
    expect(screen.queryByRole("button", { name: "设置变量" })).toBeNull();
    expect(screen.queryByRole("button", { name: "修改 EDITOR" })).toBeNull();
  });
});
