// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorState } from "./dotenvEditorController";
import { checkDrafts, type EditorTarget } from "./dotenvEditorModel";
import { DotenvEditor, type DotenvEditorActions } from "./DotenvEditor";
import type { EnvRow } from "../../ipc/environment";
import { ZshEditor, type ZshEditorActions } from "./ZshEditor";
import type { ZshEditorState } from "./zshEditorController";
import { stateOf } from "./zshEditorFixtures";
import { EMPTY_DRAFTS, checkDrafts as checkZsh, draftsFor } from "./zshEditorModel";

afterEach(() => cleanup());

const DOTENV_ACTIONS: DotenvEditorActions = {
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

const ZSH_ACTIONS: ZshEditorActions = {
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

function entry(line: number, key: string): EnvRow {
  return {
    kind: "ENTRY",
    line,
    endLine: line,
    key,
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 4,
    value: "3000",
    quote: "NONE",
    flags: [],
  };
}

const DOTENV_TARGET: EditorTarget = {
  kind: "existing",
  grantId: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
  path: ".env",
  settings: { patterns: [".env"], recursive: false },
  file: {
    relativePath: ".env",
    kind: "ENVIRONMENT",
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: 2,
    rows: [entry(1, "PORT"), entry(2, "HOST")],
    rowsTruncated: false,
    entryCount: 2,
    secretCount: 0,
    flaggedCount: 0,
  },
};

function dotenvState(patch: Partial<EditorState> = {}): EditorState {
  return {
    phase: "editing",
    target: DOTENV_TARGET,
    entryEdits: {},
    additions: [],
    nextId: 1,
    ...patch,
  };
}

function renderDotenv(state: EditorState, focus?: Parameters<typeof DotenvEditor>[0]["focus"]) {
  return render(
    <DotenvEditor
      actions={DOTENV_ACTIONS}
      check={checkDrafts(DOTENV_TARGET, { entryEdits: {}, additions: state.additions })}
      focus={focus}
      state={state}
    />,
  );
}

describe("dotenv editor focus", () => {
  it("focuses the value of the line a 修改 action named", () => {
    renderDotenv(dotenvState(), { id: 1, target: { kind: "entry", line: 2 } });
    expect(document.activeElement).toBe(screen.getByLabelText("HOST 的值"));
  });

  it("focuses the key of the row that 设置变量 added", () => {
    const state = dotenvState({ additions: [{ id: 1, key: "", value: "", exported: false }], nextId: 2 });
    renderDotenv(state, { id: 2, target: { kind: "addition" } });
    expect(document.activeElement).toBe(screen.getByLabelText("第 1 行的键名"));
  });

  it("moves focus nowhere without a request", () => {
    renderDotenv(dotenvState());
    expect(document.activeElement).not.toBe(screen.queryByLabelText("HOST 的值"));
  });
});

function zshState(patch: Partial<ZshEditorState> = {}): ZshEditorState {
  const loaded = stateOf();
  return {
    phase: "editing",
    target: { file: "ZSHRC" },
    loaded,
    drafts: draftsFor(loaded, 1),
    nextId: 100,
    ...patch,
  };
}

function renderZsh(state: ZshEditorState, focus?: Parameters<typeof ZshEditor>[0]["focus"]) {
  const check = state.loaded ? checkZsh(state.loaded, state.drafts) : undefined;
  return render(<ZshEditor actions={ZSH_ACTIONS} check={check} focus={focus} state={state} />);
}

describe("zsh editor focus", () => {
  it("focuses the value of the managed variable a 修改 action named", () => {
    renderZsh(zshState(), { id: 1, target: { kind: "variable", name: "EDITOR", line: 4 } });
    expect(document.activeElement).toBe(screen.getByLabelText("EDITOR 的值"));
  });

  it("focuses the secret replacement field for a secret variable", () => {
    renderZsh(zshState(), { id: 1, target: { kind: "variable", name: "API_TOKEN", line: 5 } });
    expect(document.activeElement).toBe(screen.getByLabelText("API_TOKEN 的新值"));
  });

  it("says so, instead of pretending, when the variable sits outside the block", () => {
    const { container } = renderZsh(zshState(), {
      id: 1,
      target: { kind: "variable", name: "LANG", line: 10 },
    });
    expect(container.textContent).toContain("LANG 在第 10 行，不在 UserHome 专用块里");
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the name of the row that 设置变量 added", () => {
    const state = zshState({
      drafts: { ...EMPTY_DRAFTS, additions: [{ id: 100, name: "", value: "" }] },
    });
    renderZsh(state, { id: 2, target: { kind: "addition" } });
    expect(document.activeElement).toBe(screen.getByLabelText("新增第 1 行的变量名"));
  });
});
