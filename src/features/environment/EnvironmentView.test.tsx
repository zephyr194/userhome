// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "../../ipc/core";
import type { EnvFileOutcome, EnvFileView, EnvRow, ScanOutcome } from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import { EMPTY_DRAFTS, checkDrafts, type EditorTarget } from "./dotenvEditorModel";
import type { EditorState } from "./dotenvEditorController";
import { EnvironmentView, type EnvironmentActions, type EnvironmentViewProps } from "./EnvironmentView";
import type { DirectoryFile, DirectoryState } from "./dotenvDirectoryModel";
import { DEFAULT_PATTERNS_TEXT } from "./environmentModel";

beforeEach(() => {
  // jsdom 没有 ResizeObserver；Headless UI 的 Listbox 打开时会构造它。空实现只满足构造。
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const GRANT_REF: Pick<GrantSummary, "id" | "displayPath"> = { id: GRANT_ID, displayPath: "~/work/proj" };
const SETTINGS = { patterns: [".env", ".env.*", "*.env"], recursive: false };
const ERROR: AppError = { code: "NOT_FOUND", message: "授权已被撤销。", retryable: false };

const SCAN: ScanOutcome = {
  root: "~/work/proj",
  recursive: false,
  patterns: SETTINGS.patterns,
  files: [
    { relativePath: ".env", name: ".env", kind: "ENVIRONMENT", sizeBytes: 120, oversized: false, symlink: false },
    { relativePath: "app/.env.example", name: ".env.example", kind: "TEMPLATE", sizeBytes: 40, oversized: false, symlink: false },
    { relativePath: "big.env", name: "big.env", kind: "ENVIRONMENT", sizeBytes: 3 * 1024 * 1024, oversized: true, symlink: true },
  ],
  skipped: [{ relativePath: ".env.link", reason: "OUTSIDE_LINK" }, { reason: "INVALID_NAME" }],
  skippedTotal: 2,
  excludedDirectories: 2,
  partialReasons: [],
  entriesExamined: 30,
  limits: { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 },
  exclusions: [".git", "node_modules"],
};

const ONE_FILE_SCAN: ScanOutcome = { ...SCAN, files: [SCAN.files[0] as ScanOutcome["files"][number]] };

function entry(overrides: Partial<Extract<EnvRow, { kind: "ENTRY" }>> = {}): EnvRow {
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

function readyFile(relativePath: string, rows: EnvRow[]): DirectoryFile {
  const file: EnvFileView = {
    relativePath,
    kind: "ENVIRONMENT",
    contentHash: "a".repeat(64),
    sizeBytes: 100,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: rows.filter((row) => row.kind === "ENTRY").length,
    secretCount: 0,
    flaggedCount: 0,
  };
  const outcome: EnvFileOutcome = { status: "READY", file };
  return { status: "loaded", requestId: 2, outcome };
}

const ENV_ROWS: EnvRow[] = [
  entry({ line: 1, key: "PORT", value: "3000" }),
  entry({ line: 2, key: "HOST", value: "localhost" }),
];

function directoryOf(patch: Partial<DirectoryState> = {}): DirectoryState {
  return {
    scan: { status: "ready", requestId: 1, outcome: SCAN, settings: SETTINGS },
    files: { ".env": readyFile(".env", ENV_ROWS) },
    ...patch,
  };
}

function makeActions(overrides: Partial<EnvironmentActions> = {}): EnvironmentActions {
  return {
    addGrant: vi.fn(),
    addVariable: vi.fn(),
    editRow: vi.fn(),
    loadValue: vi.fn(() => Promise.resolve("never")),
    newFile: vi.fn(),
    rescan: vi.fn(),
    revokeGrant: vi.fn(),
    reloadGrants: vi.fn(),
    selectFile: vi.fn(),
    setPatterns: vi.fn(),
    setRecursive: vi.fn(),
    ...overrides,
  };
}

function editorActions() {
  return {
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
}

/** A closed editor makes the page editable; without one the list is read only. */
function closedEditor(): NonNullable<EnvironmentViewProps["editor"]> {
  const state: EditorState = { phase: "closed", ...EMPTY_DRAFTS, nextId: 1 };
  return {
    actions: editorActions(),
    check: { edits: [], problems: { entries: {}, additions: {} }, ready: false },
    state,
  };
}

function viewProps(patch: Partial<EnvironmentViewProps> = {}): EnvironmentViewProps {
  return {
    grants: { status: "ready", grants: [GRANT_REF] },
    selectedGrant: GRANT_REF,
    directory: directoryOf(),
    patternsText: SETTINGS.patterns.join("\n"),
    recursive: false,
    addingGrant: false,
    actions: makeActions(),
    editor: closedEditor(),
    ...patch,
  };
}

function renderView(patch: Partial<EnvironmentViewProps> = {}) {
  return render(<EnvironmentView {...viewProps(patch)} />);
}

describe("directory tabs: empty, loading and error grants", () => {
  it("shows the loading state while grants are read", () => {
    renderView({ grants: { status: "loading" }, selectedGrant: undefined });
    expect(screen.getByText("正在读取目录授权…")).toBeTruthy();
  });

  it("shows the error with a retry that reloads the grants", () => {
    const actions = makeActions();
    renderView({ grants: { status: "error", error: ERROR }, selectedGrant: undefined, actions });
    expect(screen.getByRole("alert").textContent).toContain("授权已被撤销。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(actions.reloadGrants).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state with an add button when no directory is authorized", () => {
    const actions = makeActions();
    renderView({ grants: { status: "ready", grants: [] }, selectedGrant: undefined, actions });
    expect(screen.getByText(/还没有授权目录。/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加目录" }));
    expect(actions.addGrant).toHaveBeenCalledTimes(1);
  });

  it("disables the add button and says so while the picker is open", () => {
    renderView({
      grants: { status: "ready", grants: [] },
      selectedGrant: undefined,
      addingGrant: true,
    });
    const button = screen.getByRole("button", { name: "等待选择…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("selected directory header", () => {
  it("shows the full path of the selected directory", () => {
    renderView();
    expect(screen.getByText("~/work/proj")).toBeTruthy();
  });

  it("disables 设置变量 and names the missing file when several files are listed", () => {
    renderView();
    const button = screen.getByRole("button", { name: "设置变量" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("先在“文件”里选一个文件，再设置变量。")).toBeTruthy();
  });

  it("disables 设置变量 when the filtered file has not been read", () => {
    renderView({ directory: directoryOf({ fileFilter: "app/.env.example" }) });
    const button = screen.getByRole("button", { name: "设置变量" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("这个文件还没有读取成功，暂时不能设置变量。")).toBeTruthy();
  });

  it("enables 设置变量 for the filtered file and adds a variable to it", () => {
    const actions = makeActions();
    renderView({ directory: directoryOf({ fileFilter: ".env" }), actions });
    const button = screen.getByRole("button", { name: "设置变量" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(actions.addVariable).toHaveBeenCalledWith(".env");
  });

  it("enables 设置变量 without a filter when the directory has exactly one file", () => {
    const actions = makeActions();
    renderView({
      directory: directoryOf({
        scan: { status: "ready", requestId: 1, outcome: ONE_FILE_SCAN, settings: SETTINGS },
      }),
      actions,
    });
    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    expect(actions.addVariable).toHaveBeenCalledWith(".env");
  });

  it("calls newFile from 新建环境文件… and shows the waiting label while the panel is open", () => {
    const actions = makeActions();
    const { unmount } = renderView({ actions });
    fireEvent.click(screen.getByRole("button", { name: "新建环境文件…" }));
    expect(actions.newFile).toHaveBeenCalledTimes(1);
    unmount();

    renderView({ choosingNewFile: true, actions });
    const busy = screen.getByRole("button", { name: "等待选择…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });
});

describe("directory status", () => {
  it("shows scanning while the scan runs", () => {
    renderView({
      directory: directoryOf({ scan: { status: "loading", requestId: 3 }, files: {} }),
    });
    expect(screen.getByText("正在扫描…")).toBeTruthy();
  });

  it("shows a scan error and retries the scan when it is retryable", () => {
    const actions = makeActions();
    renderView({
      directory: directoryOf({
        scan: {
          status: "error",
          requestId: 3,
          error: { code: "PROCESS_FAILED", message: "扫描失败。", retryable: true },
        },
        files: {},
      }),
      actions,
    });
    expect(screen.getByRole("alert").textContent).toContain("扫描失败。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(actions.rescan).toHaveBeenCalledTimes(1);
  });

  it("says the result is partial and names each reason", () => {
    renderView({
      directory: directoryOf({
        scan: {
          status: "ready",
          requestId: 1,
          outcome: { ...SCAN, partialReasons: ["DEPTH_LIMIT"] },
          settings: SETTINGS,
        },
      }),
    });
    expect(screen.getByText("这是部分结果，不是完整列表。")).toBeTruthy();
    expect(screen.getByText(/已达到深度上限（5 层）/)).toBeTruthy();
  });

  it("does not claim partiality for a complete result", () => {
    renderView();
    expect(screen.queryByText("这是部分结果，不是完整列表。")).toBeNull();
  });

  it("names files that could not be read", () => {
    renderView({
      directory: directoryOf({
        files: {
          ".env": readyFile(".env", ENV_ROWS),
          "app/.env.example": { status: "error", requestId: 4, error: ERROR },
        },
      }),
    });
    expect(screen.getByText("app/.env.example 无法读取，相关变量没有列出。")).toBeTruthy();
  });

  it("counts files that are still being read", () => {
    renderView({ directory: directoryOf({ files: {} }) });
    expect(screen.getAllByText("正在读取 3 个文件…").length).toBeGreaterThan(0);
  });

  it("offers no set or edit actions without an editor, so the list is read only", () => {
    renderView({ editor: undefined });
    expect(screen.queryByRole("button", { name: "设置变量" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建环境文件…" })).toBeNull();
    expect(screen.getByRole("table", { name: "目录 dotenv 的变量" })).toBeTruthy();
  });
});

describe("layout of one directory tab", () => {
  it("places the variable table before the collapsed settings section", () => {
    renderView();
    const table = screen.getByRole("table", { name: "目录 dotenv 的变量" });
    const details = screen.getByText("文件与扫描设置");
    expect(table.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.closest("details")?.hasAttribute("open")).toBe(false);
  });

  it("places the search field above the table", () => {
    renderView();
    const search = screen.getByPlaceholderText("变量名、文件名或值");
    const table = screen.getByRole("table", { name: "目录 dotenv 的变量" });
    expect(search.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("changes the file filter through selectFile, with ALL mapping to no filter", () => {
    const actions = makeActions();
    renderView({ actions, directory: directoryOf({ fileFilter: ".env" }) });
    const trigger = document.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "全部文件" }));
    expect(actions.selectFile).toHaveBeenLastCalledWith(undefined);
  });
});

describe("scan settings", () => {
  it("explains an invalid pattern and keeps scanning disabled", () => {
    renderView({ patternsText: "   " });
    expect(screen.getByText("至少需要一个 pattern。")).toBeTruthy();
    expect(screen.getByText("先修正文件 pattern，再扫描。")).toBeTruthy();
    const scan = screen.getByRole("button", { name: "扫描" }) as HTMLButtonElement;
    expect(scan.disabled).toBe(true);
  });

  it("starts with the default patterns and enables scanning", () => {
    const actions = makeActions();
    renderView({ patternsText: DEFAULT_PATTERNS_TEXT, actions });
    const scan = screen.getByRole("button", { name: "扫描" }) as HTMLButtonElement;
    expect(scan.disabled).toBe(false);
    fireEvent.click(scan);
    expect(actions.rescan).toHaveBeenCalledTimes(1);
  });

  it("reports recursive scanning changes through setRecursive", () => {
    const actions = makeActions();
    renderView({ actions });
    fireEvent.click(screen.getByRole("switch"));
    expect(actions.setRecursive).toHaveBeenCalledWith(true);
  });

  it("tells when the settings changed after the last scan", () => {
    renderView({ recursive: true });
    expect(screen.getByText("设置已更改，重新扫描后生效。")).toBeTruthy();
  });

  it("does not show the changed hint when the settings match the last scan", () => {
    renderView();
    expect(screen.queryByText("设置已更改，重新扫描后生效。")).toBeNull();
  });
});

describe("scanned file list", () => {
  it("lists the files with template, symbolic link and size markers", () => {
    renderView();
    const list = within(screen.getByRole("list", { name: "匹配的环境文件" }));
    expect(screen.getByText("扫描到的文件（3）")).toBeTruthy();
    expect(list.getByText("模板")).toBeTruthy();
    expect(list.getByText("符号链接")).toBeTruthy();
    expect(list.getByText("过大")).toBeTruthy();
    expect(list.getByText("app/.env.example")).toBeTruthy();
  });
});

describe("editor open", () => {
  it("replaces the variable list with the editor", () => {
    const target: EditorTarget = {
      kind: "existing",
      grantId: GRANT_ID,
      path: ".env",
      settings: SETTINGS,
      file: {
        relativePath: ".env",
        kind: "ENVIRONMENT",
        contentHash: "a".repeat(64),
        sizeBytes: 100,
        lineCount: 2,
        rows: ENV_ROWS,
        rowsTruncated: false,
        entryCount: 2,
        secretCount: 0,
        flaggedCount: 0,
      },
    };
    const state: EditorState = { phase: "editing", target, ...EMPTY_DRAFTS, nextId: 1 };
    const actions = editorActions();
    renderView({
      editor: {
        actions,
        check: checkDrafts(target, state),
        state,
      },
    });
    expect(screen.getByRole("heading", { name: "编辑环境文件" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "目录 dotenv 的变量" })).toBeNull();
    expect(screen.queryByText("文件与扫描设置")).toBeNull();
  });
});
