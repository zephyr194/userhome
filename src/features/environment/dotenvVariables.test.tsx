// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvFileOutcome, EnvRow } from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import { EnvironmentView, type EnvironmentViewProps } from "./EnvironmentView";
import {
  INITIAL_ENVIRONMENT_STATE,
  type EnvironmentState,
} from "./environmentModel";

afterEach(() => cleanup());

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const GRANT: GrantSummary = {
  id: GRANT_ID,
  purpose: "CONFIG_DIRECTORY",
  kind: "DIRECTORY",
  displayPath: "~/work/proj",
  createdAtEpochMs: 1,
};
const SETTINGS = { patterns: [".env"], recursive: false };

function entry(overrides: Partial<Extract<EnvRow, { kind: "ENTRY" }>>): EnvRow {
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

function loadedState(rows: EnvRow[]): EnvironmentState {
  const outcome: EnvFileOutcome = {
    status: "READY",
    file: {
      relativePath: ".env",
      kind: "ENVIRONMENT",
      contentHash: "a".repeat(64),
      sizeBytes: 100,
      lineCount: rows.length,
      rows,
      rowsTruncated: false,
      entryCount: rows.filter((row) => row.kind === "ENTRY").length,
      secretCount: 0,
      flaggedCount: rows.filter((row) => row.kind === "ENTRY" && row.flags.length > 0).length,
    },
  };
  return {
    ...INITIAL_ENVIRONMENT_STATE,
    grants: { status: "ready", grants: [GRANT] },
    selectedGrantId: GRANT_ID,
    scan: {
      status: "ready",
      requestId: 1,
      settings: SETTINGS,
      outcome: {
        root: "~/work/proj",
        recursive: false,
        patterns: SETTINGS.patterns,
        files: [{ relativePath: ".env", name: ".env", kind: "ENVIRONMENT", sizeBytes: 1, oversized: false, symlink: false }],
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
    file: { status: "loaded", requestId: 2, path: ".env", outcome },
  };
}

const ROWS: EnvRow[] = [
  entry({ line: 1, key: "PORT", value: "3000", flags: ["DUPLICATE_KEY"] }),
  entry({ line: 2, key: "HOST", value: "localhost" }),
  entry({ line: 3, key: "PORT", value: "8080", flags: ["DUPLICATE_KEY"] }),
];

function renderView(state: EnvironmentState, overrides: Partial<EnvironmentViewProps> = {}) {
  return render(
    <EnvironmentView
      addingGrant={false}
      onAddGrant={() => undefined}
      onLoadValue={() => Promise.resolve("never")}
      onPatternsChange={() => undefined}
      onRecursiveChange={() => undefined}
      onReloadGrants={() => undefined}
      onRevokeGrant={() => undefined}
      onScan={() => undefined}
      onSelectFile={() => undefined}
      onSelectGrant={() => undefined}
      state={state}
      {...overrides}
    />,
  );
}

describe("dotenv view: a key that repeats shows its last line only", () => {
  it("renders the key once, with the value that takes effect", () => {
    renderView(loadedState(ROWS));
    expect(screen.getAllByText("PORT")).toHaveLength(1);
    expect(screen.getByText("8080")).toBeTruthy();
    expect(screen.queryByText("3000")).toBeNull();
    expect(screen.queryByText("冲突：重复键")).toBeNull();
  });

  it("says how many earlier lines it replaces, without showing their values", () => {
    const { container } = renderView(loadedState(ROWS));
    expect(screen.getByText("覆盖了前面 1 处")).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：PORT 的覆盖位置" })).toBeTruthy();
    expect(container.textContent).toContain(".env 第 1 行");
    expect(container.textContent).not.toContain("3000");
  });

  it("omits the hint for keys that appear once", () => {
    renderView(loadedState(ROWS));
    expect(screen.queryByText(/覆盖了前面 0 处/)).toBeNull();
    expect(screen.getAllByText("HOST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "说明：HOST 的覆盖位置" })).toBeNull();
  });

  it("counts variables after collapsing repeats", () => {
    const { container } = renderView(loadedState(ROWS));
    expect(container.textContent).toContain("2 项");
  });
});

describe("dotenv view: variable actions", () => {
  it("opens the editor with a new row from 设置变量", () => {
    const onEditFile = vi.fn();
    renderView(loadedState(ROWS), { onEditFile });
    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    expect(onEditFile).toHaveBeenCalledWith({ kind: "addition" });
  });

  it("disables 设置变量 when no file is loaded", () => {
    const onEditFile = vi.fn();
    renderView({ ...loadedState(ROWS), file: { status: "idle" }, selectedPath: undefined }, { onEditFile });
    const button = screen.getByRole("button", { name: "设置变量" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("opens the editor on the line that takes effect from 修改", () => {
    const onEditFile = vi.fn();
    renderView(loadedState(ROWS), { onEditFile });
    fireEvent.click(screen.getByRole("button", { name: "修改 PORT" }));
    expect(onEditFile).toHaveBeenLastCalledWith({ kind: "entry", line: 3 });
    fireEvent.click(screen.getByRole("button", { name: "修改 HOST" }));
    expect(onEditFile).toHaveBeenLastCalledWith({ kind: "entry", line: 2 });
  });

  it("offers no edit actions without an editor", () => {
    renderView(loadedState(ROWS));
    expect(screen.queryByRole("button", { name: "设置变量" })).toBeNull();
    expect(screen.queryByRole("button", { name: "修改 HOST" })).toBeNull();
  });
});
