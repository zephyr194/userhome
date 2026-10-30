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

function variableList(): HTMLElement {
  return screen.getByRole("region", { name: "目录 dotenv 的变量" });
}

function detail(): HTMLElement {
  return screen.getByRole("region", { name: "选中变量的详情" });
}

function listNames(): (string | undefined)[] {
  return within(variableList())
    .getAllByRole("button")
    .map((button) => button.querySelector("code")?.textContent);
}

function selectVariable(name: string) {
  const button = within(variableList())
    .getAllByRole("button")
    .find((candidate) => candidate.querySelector("code")?.textContent === name);
  if (!button) throw new Error(`no variable row for ${name}`);
  fireEvent.click(button);
}

describe("dotenv list: a key that repeats in one file", () => {
  const files = {
    ".env": file(".env", [
      entry(1, "PORT", "3000"),
      entry(2, "HOST", "localhost"),
      entry(3, "PORT", "8080"),
    ]),
  };

  it("lists one row per name in alphabetical order", () => {
    renderView(directory(files));
    expect(listNames()).toEqual(["HOST", "PORT"]);
  });

  it("shows the value that takes effect as the final value, with its source", () => {
    renderView(directory(files));
    selectVariable("PORT");
    expect(within(detail()).getByText("最终生效值")).toBeTruthy();
    expect(within(detail()).getByText("8080")).toBeTruthy();
    expect(within(detail()).getByText(".env:3")).toBeTruthy();
  });

  it("keeps the earlier line as a process value that shows once the name is selected", () => {
    renderView(directory(files));
    expect(screen.queryByText("3000")).toBeNull();
    selectVariable("PORT");
    expect(within(detail()).getByText("过程值（读取顺序）")).toBeTruthy();
    expect(within(detail()).getByText("3000")).toBeTruthy();
    expect(within(detail()).getByText(".env:1")).toBeTruthy();
  });

  it("opens the editor on the line that takes effect", () => {
    const actions = renderView(directory(files));
    selectVariable("PORT");
    fireEvent.click(within(detail()).getByRole("button", { name: "修改 PORT" }));
    expect(actions.editRow).toHaveBeenLastCalledWith(".env", 3);
    selectVariable("HOST");
    fireEvent.click(within(detail()).getByRole("button", { name: "修改 HOST" }));
    expect(actions.editRow).toHaveBeenLastCalledWith(".env", 2);
  });
});

describe("dotenv list: a single-file key", () => {
  it("shows its value as the final value once it is selected, with the line it comes from", () => {
    renderView(directory({ ".env": file(".env", [entry(1, "HOST", "localhost")]) }));
    selectVariable("HOST");
    expect(within(detail()).getByText("最终生效值")).toBeTruthy();
    expect(within(detail()).getByText("localhost")).toBeTruthy();
    expect(within(detail()).getByText(".env:1")).toBeTruthy();
    expect(within(detail()).queryByText("过程值（读取顺序）")).toBeNull();
  });
});

describe("dotenv list: a name defined in several files", () => {
  const files = {
    ".env": file(".env", [entry(1, "PORT", "3000")]),
    "app/.env.local": file("app/.env.local", [entry(4, "PORT", "5000"), entry(5, "REGION", "cn")]),
  };

  it("lists the name once with a count of files and no final value", () => {
    renderView(directory(files));
    expect(listNames()).toEqual(["PORT", "REGION"]);
    expect(within(variableList()).getByRole("button", { name: /^PORT.*在 2 个文件中定义/ })).toBeTruthy();
    selectVariable("PORT");
    expect(within(detail()).queryByText("最终生效值")).toBeNull();
    expect(within(detail()).queryByText("8080")).toBeNull();
  });

  it("explains that no file is ranked above another", () => {
    renderView(directory(files));
    selectVariable("PORT");
    expect(screen.getByText(/这里不判断哪一个生效/)).toBeTruthy();
    expect(within(detail()).getByText(/这里不推断/)).toBeTruthy();
  });

  it("lists each file's value side by side in the detail, without a final value", () => {
    renderView(directory(files));
    selectVariable("PORT");
    expect(within(detail()).getByText("各文件的值（读取顺序）")).toBeTruthy();
    expect(within(detail()).getByText("3000")).toBeTruthy();
    expect(within(detail()).getByText("5000")).toBeTruthy();
    expect(within(detail()).getByText(".env:1")).toBeTruthy();
    expect(within(detail()).getByText("app/.env.local:4")).toBeTruthy();
    expect(within(detail()).queryByText("最终生效值")).toBeNull();
  });

  it("has no edit or reveal action on the merged name", () => {
    renderView(directory(files));
    selectVariable("PORT");
    expect(screen.queryByRole("button", { name: "修改 PORT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "载入" })).toBeNull();
  });

  it("gives the single-file row a final value and an edit action once the file filter narrows the list", () => {
    const actions = renderView(directory(files, "app/.env.local"));
    selectVariable("PORT");
    expect(within(detail()).getByText("最终生效值")).toBeTruthy();
    expect(within(detail()).getByText("5000")).toBeTruthy();
    fireEvent.click(within(detail()).getByRole("button", { name: "修改 PORT" }));
    expect(actions.editRow).toHaveBeenCalledWith("app/.env.local", 4);
  });

  it("renders the merged name in English", () => {
    renderView(directory(files), {}, "en");
    const list = screen.getByRole("region", { name: "Directory dotenv variables" });
    expect(within(list).getByText("Defined in 2 files")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: /^PORT/ }));
    const englishDetail = screen.getByRole("region", { name: "Selected variable details" });
    expect(within(englishDetail).getByText("Values in each file (reading order)")).toBeTruthy();
    expect(within(englishDetail).queryByText("Final value")).toBeNull();
  });
});

describe("dotenv list: a file that was cut short", () => {
  it("shows the truncated note on the names it defines", () => {
    renderView(
      directory({
        ".env": file(".env", [entry(1, "PORT", "3000"), entry(2, "PORT", "4000")], true),
      }),
    );
    selectVariable("PORT");
    expect(
      within(detail()).getByText("文件行数过多，只读取了前面的行，后面可能还有同名变量。"),
    ).toBeTruthy();
  });

  it("keeps the value it read and shows the note beside it", () => {
    renderView(
      directory({
        ".env": file(".env", [entry(1, "HOST", "localhost")], true),
      }),
    );
    selectVariable("HOST");
    expect(within(detail()).getByText("localhost")).toBeTruthy();
    expect(
      within(detail()).getByText("文件行数过多，只读取了前面的行，后面可能还有同名变量。"),
    ).toBeTruthy();
  });
});
