// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleContext, createLocaleValue } from "../../i18n/localeContext";
import type { EnvFileOutcome, EnvFileView, EnvRow, ScanOutcome } from "../../ipc/environment";
import type { DirectoryFile, DirectoryState } from "./dotenvDirectoryModel";
import { EnvironmentView, type EnvironmentActions, type EnvironmentViewProps } from "./EnvironmentView";
import { EMPTY_DRAFTS } from "./dotenvEditorModel";

afterEach(() => cleanup());

const GRANT = { id: "grant-1", displayPath: "~/work/proj" };
const SETTINGS = { patterns: [".env", "app/.env.*"], recursive: true };

function entry(line: number, key: string, value: string): EnvRow {
  return {
    kind: "ENTRY",
    line,
    endLine: line,
    key,
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: value.length,
    value,
    quote: "NONE",
    flags: [],
  };
}

function file(relativePath: string, rows: EnvRow[], rowsTruncated = false): DirectoryFile {
  const view: EnvFileView = {
    relativePath,
    kind: "ENVIRONMENT",
    contentHash: "b".repeat(64),
    sizeBytes: 64,
    lineCount: rows.length,
    rows,
    rowsTruncated,
    entryCount: rows.length,
    secretCount: 0,
    flaggedCount: 0,
  };
  const outcome: EnvFileOutcome = { status: "READY", file: view };
  return { status: "loaded", requestId: 5, outcome };
}

function scanOf(paths: string[]): ScanOutcome {
  return {
    root: "~/work/proj",
    recursive: true,
    patterns: SETTINGS.patterns,
    files: paths.map((path) => ({
      relativePath: path,
      name: path.split("/").pop() ?? path,
      kind: "ENVIRONMENT",
      sizeBytes: 64,
      oversized: false,
      symlink: false,
    })),
    skipped: [],
    skippedTotal: 0,
    excludedDirectories: 0,
    partialReasons: [],
    entriesExamined: paths.length,
    limits: { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 },
    exclusions: [],
  };
}

function directory(files: Record<string, DirectoryFile>, fileFilter?: string): DirectoryState {
  return {
    scan: {
      status: "ready",
      requestId: 1,
      outcome: scanOf(Object.keys(files)),
      settings: SETTINGS,
    },
    files,
    ...(fileFilter === undefined ? {} : { fileFilter }),
  };
}

function makeActions(): EnvironmentActions {
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
  };
}

function renderView(
  directoryState: DirectoryState,
  patch: Partial<EnvironmentViewProps> = {},
  locale: "zh-CN" | "en" = "zh-CN",
) {
  const actions = makeActions();
  const props: EnvironmentViewProps = {
    grants: { status: "ready", grants: [GRANT] },
    selectedGrant: GRANT,
    directory: directoryState,
    patternsText: SETTINGS.patterns.join("\n"),
    recursive: true,
    addingGrant: false,
    actions,
    editor: {
      actions: {
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
      },
      check: { edits: [], problems: { entries: {}, additions: {} }, ready: false },
      state: { phase: "closed", ...EMPTY_DRAFTS, nextId: 1 },
    },
    ...patch,
  };
  render(
    <LocaleContext.Provider value={createLocaleValue(locale)}>
      <EnvironmentView {...props} />
    </LocaleContext.Provider>,
  );
  return actions;
}

function bodyRow(name: string): HTMLElement {
  const table = screen.getByRole("table");
  const row = within(table)
    .getAllByRole("row")
    .slice(1)
    .find((candidate) => candidate.querySelector("code")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("dotenv table: a key that repeats in one file", () => {
  const files = {
    ".env": file(".env", [
      entry(1, "PORT", "3000"),
      entry(2, "HOST", "localhost"),
      entry(3, "PORT", "8080"),
    ]),
  };

  it("shows the value that takes effect as the final value, once per name", () => {
    renderView(directory(files));
    const table = screen.getByRole("table", { name: "目录 dotenv 的变量" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(2);
    expect(within(bodyRow("PORT")).getByText("8080")).toBeTruthy();
    expect(within(bodyRow("PORT")).getByText(".env:3")).toBeTruthy();
  });

  it("marks the final value with a 最终 badge once the chain is opened", () => {
    renderView(directory(files));
    fireEvent.click(within(bodyRow("PORT")).getByRole("button", { name: "过程值 1" }));
    expect(screen.getByText("最终")).toBeTruthy();
  });

  it("keeps the earlier line as a process value that opens on demand", () => {
    renderView(directory(files));
    expect(screen.queryByText("3000")).toBeNull();
    fireEvent.click(within(bodyRow("PORT")).getByRole("button", { name: "过程值 1" }));
    expect(screen.getByText("3000")).toBeTruthy();
    expect(screen.getByText(".env:1")).toBeTruthy();
  });

  it("opens the editor on the line that takes effect", () => {
    const actions = renderView(directory(files));
    fireEvent.click(screen.getByRole("button", { name: "修改 PORT" }));
    expect(actions.editRow).toHaveBeenLastCalledWith(".env", 3);
    fireEvent.click(screen.getByRole("button", { name: "修改 HOST" }));
    expect(actions.editRow).toHaveBeenLastCalledWith(".env", 2);
  });
});

describe("dotenv table: a name defined in several files", () => {
  const files = {
    ".env": file(".env", [entry(1, "PORT", "3000")]),
    "app/.env.local": file("app/.env.local", [entry(4, "PORT", "5000"), entry(5, "REGION", "cn")]),
  };

  it("lists the name once with a count of files and no final badge", () => {
    renderView(directory(files));
    const row = bodyRow("PORT");
    expect(within(row).getByText("在 2 个文件中定义")).toBeTruthy();
    expect(within(row).getByText("多个文件")).toBeTruthy();
    expect(within(row).queryByText("最终")).toBeNull();
    expect(within(row).queryByText("3000")).toBeNull();
    expect(screen.getAllByText("PORT")).toHaveLength(1);
  });

  it("explains that no file is ranked above another", () => {
    renderView(directory(files));
    expect(screen.getByText(/这里不判断哪一个生效/)).toBeTruthy();
  });

  it("lists each file's value side by side in the expansion, without a final badge", () => {
    renderView(directory(files));
    fireEvent.click(within(bodyRow("PORT")).getByRole("button", { name: "各文件的值 2" }));
    const list = screen.getByRole("list", { name: "PORT 在各文件中的值" });
    expect(within(list).getByText("3000")).toBeTruthy();
    expect(within(list).getByText("5000")).toBeTruthy();
    expect(within(list).getByText(".env:1")).toBeTruthy();
    expect(within(list).getByText("app/.env.local:4")).toBeTruthy();
    expect(within(list).queryByText("最终")).toBeNull();
  });

  it("has no edit or reveal action on the merged row", () => {
    renderView(directory(files));
    expect(screen.queryByRole("button", { name: "修改 PORT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "载入" })).toBeNull();
  });

  it("gives the single-file row an edit action once the file filter narrows the list", () => {
    const actions = renderView(directory(files, "app/.env.local"));
    expect(within(bodyRow("PORT")).getByText("5000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改 PORT" }));
    expect(actions.editRow).toHaveBeenCalledWith("app/.env.local", 4);
  });

  it("renders the merged name in English", () => {
    renderView(directory(files), {}, "en");
    expect(within(bodyRow("PORT")).getByText("Defined in 2 files")).toBeTruthy();
    expect(within(bodyRow("PORT")).getByText("Several files")).toBeTruthy();
    expect(within(bodyRow("PORT")).getByRole("button", { name: "Values in 2 files" })).toBeTruthy();
  });
});

describe("dotenv table: a file that was cut short", () => {
  it("shows the truncated note on the names it defines", () => {
    renderView(
      directory({
        ".env": file(".env", [entry(1, "PORT", "3000"), entry(2, "PORT", "4000")], true),
      }),
    );
    expect(
      within(bodyRow("PORT")).getByText("文件行数过多，只读取了前面的行，后面可能还有同名变量。"),
    ).toBeTruthy();
  });

  it("keeps the value it read and shows the note beside it", () => {
    renderView(
      directory({
        ".env": file(".env", [entry(1, "HOST", "localhost")], true),
      }),
    );
    expect(within(bodyRow("HOST")).getByText("localhost")).toBeTruthy();
    expect(
      within(bodyRow("HOST")).getByText("文件行数过多，只读取了前面的行，后面可能还有同名变量。"),
    ).toBeTruthy();
  });
});
