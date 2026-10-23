// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("zsh view: a name assigned in more than one file", () => {
  it("shows each assignment that takes effect, with the shells it applies to", () => {
    renderView(stateOf(FILES));
    expect(screen.getAllByText("EDITOR")).toHaveLength(2);
    expect(screen.getByText("vim")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("部分范围被覆盖")).toBeTruthy();
  });

  it("says which shells the later assignment overrides, and that non-interactive zsh keeps the earlier value", () => {
    const { container } = renderView(stateOf(FILES));
    expect(container.textContent).toContain(".zshrc 第 3 行（仅交互 shell）");
    expect(container.textContent).toContain("非交互 zsh 仍使用前面的值。");
  });

  it("renders a same-shell replacement once, and says how many earlier assignments it replaces", () => {
    const { container } = renderView(
      stateOf([
        file("ZPROFILE", ready([entry({ line: 1, name: "EDITOR", value: "vim" })])),
        file("ZLOGIN", ready([entry({ line: 3, name: "EDITOR", value: "code" })])),
      ]),
    );
    expect(screen.getByText("覆盖了前面 1 处")).toBeTruthy();
    expect(container.textContent).toContain(".zprofile 第 1 行");
    expect(container.textContent).not.toContain("vim");
  });

  it("keeps every occurrence and says so when the last one appends", () => {
    const { container } = renderView(
      stateOf([
        file("ZSHENV", ready([entry({ line: 1, name: "PATH", value: "/usr/bin" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "PATH", operation: "APPEND", value: "/opt/bin" })])),
      ]),
    );
    expect(screen.getAllByText("同名 2 处，未合并")).toHaveLength(2);
    expect(screen.getByText("/usr/bin")).toBeTruthy();
    expect(screen.getByText("/opt/bin")).toBeTruthy();
    expect(container.textContent).not.toContain("覆盖了前面");
  });

  it("no longer shows the separate same-name section", () => {
    renderView(stateOf(FILES));
    expect(screen.queryByText("同名项对照")).toBeNull();
  });
});

describe("zsh view: variable actions", () => {
  it("opens the managed block of .zshrc with a new variable from 设置变量", () => {
    const onEditFile = vi.fn();
    renderView(stateOf(FILES), { onEditFile });
    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    expect(onEditFile).toHaveBeenCalledWith("ZSHRC", { kind: "addition" });
  });

  it("opens the file and line of the assignment each 修改 button belongs to", () => {
    const onEditFile = vi.fn();
    renderView(stateOf(FILES), { onEditFile });
    const [zshenvEdit, zshrcEdit] = screen.getAllByRole("button", { name: "修改 EDITOR" });
    fireEvent.click(zshrcEdit as HTMLElement);
    expect(onEditFile).toHaveBeenLastCalledWith("ZSHRC", { kind: "variable", name: "EDITOR", line: 3 });
    fireEvent.click(zshenvEdit as HTMLElement);
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
