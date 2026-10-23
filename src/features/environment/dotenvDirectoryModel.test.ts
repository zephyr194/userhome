import { describe, expect, it } from "vitest";
import type { EnvFileOutcome, ScanOutcome, ScanSettings } from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import {
  EMPTY_DIRECTORY,
  INITIAL_WORKSPACE,
  directoryGrants,
  directoryOf,
  directoryTabLabels,
  directoryVariableSources,
  workspaceReducer,
  type DirectoryState,
  type DotenvWorkspaceState,
} from "./dotenvDirectoryModel";

const SETTINGS: ScanSettings = { patterns: [".env*"], recursive: false };

function grant(id: string, displayPath: string, extra: Partial<GrantSummary> = {}): GrantSummary {
  return {
    id,
    displayPath,
    kind: "DIRECTORY",
    purpose: "CONFIG_DIRECTORY",
    createdAtEpochMs: 0,
    ...extra,
  } as GrantSummary;
}

function scanOf(paths: readonly string[]): ScanOutcome {
  return { files: paths.map((relativePath) => ({ relativePath })) } as unknown as ScanOutcome;
}

function readyFile(path: string, rows: unknown[], truncated = false): EnvFileOutcome {
  return {
    status: "READY",
    file: { relativePath: path, rows, rowsTruncated: truncated },
  } as unknown as EnvFileOutcome;
}

function withDirectory(state: DotenvWorkspaceState, grantId: string, directory: DirectoryState) {
  return { ...state, directories: { ...state.directories, [grantId]: directory } };
}

describe("directoryGrants", () => {
  it("keeps directory grants and drops the Caddy work directory", () => {
    const result = directoryGrants([
      grant("a", "~/p/a"),
      grant("c", "~/caddy", { purpose: "CADDY_WORK_DIR" }),
      grant("f", "~/p/x.env", { kind: "FILE" as GrantSummary["kind"] }),
    ]);
    expect(result).toEqual([{ id: "a", displayPath: "~/p/a" }]);
  });
});

describe("directoryTabLabels", () => {
  it("uses the folder name and keeps the full path as the title", () => {
    expect(directoryTabLabels([{ id: "a", displayPath: "~/JustDoIt/app" }])).toEqual([
      { id: "a", label: "app", title: "~/JustDoIt/app" },
    ]);
  });

  it("adds the parent folder when two folders share a name", () => {
    const labels = directoryTabLabels([
      { id: "a", displayPath: "~/work/api" },
      { id: "b", displayPath: "~/home/api" },
      { id: "c", displayPath: "~/work/web" },
    ]);
    expect(labels.map((tab) => tab.label)).toEqual(["work/api", "home/api", "web"]);
  });

  it("ignores a trailing slash", () => {
    expect(directoryTabLabels([{ id: "a", displayPath: "~/app/" }])[0]?.label).toBe("app");
  });
});

describe("workspaceReducer", () => {
  it("restores the remembered directory when it is still authorized", () => {
    const state = workspaceReducer(INITIAL_WORKSPACE, {
      type: "grantsLoaded",
      grants: [grant("a", "~/a"), grant("b", "~/b")],
      remembered: "b",
    });
    expect(state.selectedGrantId).toBe("b");
  });

  it("falls back to the first directory when the remembered one is gone", () => {
    const state = workspaceReducer(INITIAL_WORKSPACE, {
      type: "grantsLoaded",
      grants: [grant("a", "~/a")],
      remembered: "gone",
    });
    expect(state.selectedGrantId).toBe("a");
  });

  it("keeps each directory's scan separately", () => {
    let state = workspaceReducer(INITIAL_WORKSPACE, {
      type: "grantsLoaded",
      grants: [grant("a", "~/a"), grant("b", "~/b")],
    });
    state = workspaceReducer(state, { type: "scanRequested", grantId: "a", requestId: 1 });
    state = workspaceReducer(state, { type: "scanRequested", grantId: "b", requestId: 2 });
    expect(directoryOf(state, "a").scan).toEqual({ status: "loading", requestId: 1 });
    expect(directoryOf(state, "b").scan).toEqual({ status: "loading", requestId: 2 });
  });

  it("ignores a scan answer that no longer matches the current request", () => {
    let state = workspaceReducer(INITIAL_WORKSPACE, {
      type: "grantsLoaded",
      grants: [grant("a", "~/a")],
    });
    state = workspaceReducer(state, { type: "scanRequested", grantId: "a", requestId: 2 });
    state = workspaceReducer(state, {
      type: "scanSucceeded",
      grantId: "a",
      requestId: 1,
      outcome: scanOf([]),
      settings: SETTINGS,
    });
    expect(directoryOf(state, "a").scan.status).toBe("loading");
  });

  it("clears the file reads of a directory when it is scanned again", () => {
    let state = withDirectory(INITIAL_WORKSPACE, "a", {
      scan: { status: "ready", requestId: 1, outcome: scanOf(["x.env"]), settings: SETTINGS },
      files: { "x.env": { status: "loaded", requestId: 2, outcome: readyFile("x.env", []) } },
    });
    state = workspaceReducer(state, { type: "scanRequested", grantId: "a", requestId: 3 });
    expect(directoryOf(state, "a").files).toEqual({});
  });

  it("drops a file answer from an older scan", () => {
    let state = withDirectory(INITIAL_WORKSPACE, "a", EMPTY_DIRECTORY);
    state = workspaceReducer(state, { type: "fileRequested", grantId: "a", requestId: 5, path: "x.env" });
    state = workspaceReducer(state, {
      type: "fileLoaded",
      grantId: "a",
      requestId: 4,
      path: "x.env",
      outcome: readyFile("x.env", []),
    });
    expect(directoryOf(state, "a").files["x.env"]).toEqual({ status: "loading", requestId: 5 });
  });

  it("drops a file filter whose file the new scan no longer lists", () => {
    let state = withDirectory(INITIAL_WORKSPACE, "a", { ...EMPTY_DIRECTORY, fileFilter: "gone.env" });
    state = workspaceReducer(state, { type: "scanRequested", grantId: "a", requestId: 1 });
    state = workspaceReducer(state, {
      type: "scanSucceeded",
      grantId: "a",
      requestId: 1,
      outcome: scanOf(["x.env"]),
      settings: SETTINGS,
    });
    expect(directoryOf(state, "a").fileFilter).toBeUndefined();
  });

  it("stores the file filter per directory", () => {
    const state = workspaceReducer(INITIAL_WORKSPACE, {
      type: "fileFilterChanged",
      grantId: "a",
      path: "b.env",
    });
    expect(directoryOf(state, "a").fileFilter).toBe("b.env");
    expect(directoryOf(state, "z").fileFilter).toBeUndefined();
  });
});

describe("directoryVariableSources", () => {
  const ready: DirectoryState = {
    scan: { status: "ready", requestId: 1, outcome: scanOf(["a.env", "b.env", "c.env"]), settings: SETTINGS },
    files: {
      "a.env": { status: "loaded", requestId: 2, outcome: readyFile("a.env", [{ kind: "ENTRY" }]) },
      "b.env": {
        status: "loaded",
        requestId: 3,
        outcome: { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "" } as unknown as EnvFileOutcome,
      },
    },
  };

  it("lists readable files, reports unreadable ones, and counts files still being read", () => {
    const sources = directoryVariableSources(ready);
    expect(sources.readable.map((file) => file.relativePath)).toEqual(["a.env"]);
    expect(sources.unreadable).toEqual(["b.env"]);
    expect(sources.pending).toBe(1);
  });

  it("keeps the truncation flag of a readable file", () => {
    const sources = directoryVariableSources({
      ...ready,
      files: { "a.env": { status: "loaded", requestId: 2, outcome: readyFile("a.env", [], true) } },
    });
    expect(sources.readable[0]?.truncated).toBe(true);
  });

  it("only includes the filtered file", () => {
    const sources = directoryVariableSources({ ...ready, fileFilter: "b.env" });
    expect(sources.readable).toEqual([]);
    expect(sources.unreadable).toEqual(["b.env"]);
    expect(sources.pending).toBe(0);
  });

  it("returns nothing before a scan is ready", () => {
    expect(directoryVariableSources(EMPTY_DIRECTORY)).toEqual({ readable: [], unreadable: [], pending: 0 });
  });
});
