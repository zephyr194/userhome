import type { AppError } from "../../ipc/core";
import type { EnvFileOutcome, ScanOutcome, ScanSettings } from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import type { DotenvFileRows } from "./variableChainModel";
import { DEFAULT_PATTERNS_TEXT } from "./environmentModel";

export type DirectoryGrant = Pick<GrantSummary, "id" | "displayPath">;

export type DirectoryScan =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly requestId: number }
  | {
      readonly status: "ready";
      readonly requestId: number;
      readonly outcome: ScanOutcome;
      readonly settings: ScanSettings;
    }
  | { readonly status: "error"; readonly requestId: number; readonly error: AppError };

export type DirectoryFile =
  | { readonly status: "loading"; readonly requestId: number }
  | { readonly status: "loaded"; readonly requestId: number; readonly outcome: EnvFileOutcome }
  | { readonly status: "error"; readonly requestId: number; readonly error: AppError };

/** Everything one directory tab shows. Each tab keeps its own scan and file reads. */
export interface DirectoryState {
  readonly scan: DirectoryScan;
  /** Keyed by the relative path from the scan result. */
  readonly files: Readonly<Record<string, DirectoryFile>>;
  /** Only this file's variables are listed; undefined lists every file. */
  readonly fileFilter?: string;
}

export type DirectoriesGrantsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly grants: readonly DirectoryGrant[] }
  | { readonly status: "error"; readonly error: AppError };

export interface DotenvWorkspaceState {
  readonly grants: DirectoriesGrantsState;
  readonly selectedGrantId?: string;
  readonly patternsText: string;
  readonly recursive: boolean;
  readonly directories: Readonly<Record<string, DirectoryState>>;
}

export const EMPTY_DIRECTORY: DirectoryState = { scan: { status: "idle" }, files: {} };

export type DotenvWorkspaceAction =
  | { type: "grantsLoaded"; grants: readonly GrantSummary[]; remembered?: string }
  | { type: "grantsFailed"; error: AppError }
  | { type: "grantSelected"; grantId: string }
  | { type: "patternsChanged"; text: string }
  | { type: "recursiveChanged"; recursive: boolean }
  | { type: "scanRequested"; grantId: string; requestId: number }
  | {
      type: "scanSucceeded";
      grantId: string;
      requestId: number;
      outcome: ScanOutcome;
      settings: ScanSettings;
    }
  | { type: "scanFailed"; grantId: string; requestId: number; error: AppError }
  | { type: "fileRequested"; grantId: string; requestId: number; path: string }
  | { type: "fileLoaded"; grantId: string; requestId: number; path: string; outcome: EnvFileOutcome }
  | { type: "fileFailed"; grantId: string; requestId: number; path: string; error: AppError }
  | { type: "fileFilterChanged"; grantId: string; path?: string };

/** The Caddy work directory belongs to the Caddy page; it is not a generic directory. */
export function directoryGrants(grants: readonly GrantSummary[]): DirectoryGrant[] {
  return grants
    .filter((grant) => grant.kind === "DIRECTORY" && grant.purpose !== "CADDY_WORK_DIR")
    .map((grant) => ({ id: grant.id, displayPath: grant.displayPath }));
}

export const INITIAL_WORKSPACE: DotenvWorkspaceState = {
  grants: { status: "loading" },
  patternsText: DEFAULT_PATTERNS_TEXT,
  recursive: false,
  directories: {},
};

function patchDirectory(
  state: DotenvWorkspaceState,
  grantId: string,
  patch: (directory: DirectoryState) => DirectoryState,
): DotenvWorkspaceState {
  const current = state.directories[grantId] ?? EMPTY_DIRECTORY;
  return { ...state, directories: { ...state.directories, [grantId]: patch(current) } };
}

/**
 * Responses carry the request id they were made with. One that no longer matches
 * the current scan or file read is dropped, so an answer for an old scan or a
 * previous selection never replaces what the user sees.
 */
export function workspaceReducer(
  state: DotenvWorkspaceState,
  action: DotenvWorkspaceAction,
): DotenvWorkspaceState {
  switch (action.type) {
    case "grantsLoaded": {
      const grants = directoryGrants(action.grants);
      const known = (id: string | undefined) => grants.some((grant) => grant.id === id);
      const selectedGrantId = known(state.selectedGrantId)
        ? state.selectedGrantId
        : known(action.remembered)
          ? action.remembered
          : grants[0]?.id;
      return { ...state, grants: { status: "ready", grants }, selectedGrantId };
    }
    case "grantsFailed":
      return { ...state, grants: { status: "error", error: action.error } };
    case "grantSelected":
      return { ...state, selectedGrantId: action.grantId };
    case "patternsChanged":
      return { ...state, patternsText: action.text };
    case "recursiveChanged":
      return { ...state, recursive: action.recursive };
    case "scanRequested":
      return patchDirectory(state, action.grantId, (directory) => ({
        scan: { status: "loading", requestId: action.requestId },
        files: {},
        fileFilter: directory.fileFilter,
      }));
    case "scanSucceeded":
      return patchDirectory(state, action.grantId, (directory) =>
        isCurrent(directory.scan, action.requestId)
          ? {
              ...directory,
              scan: {
                status: "ready",
                requestId: action.requestId,
                outcome: action.outcome,
                settings: action.settings,
              },
              fileFilter: action.outcome.files.some(
                (file) => file.relativePath === directory.fileFilter,
              )
                ? directory.fileFilter
                : undefined,
            }
          : directory,
      );
    case "scanFailed":
      return patchDirectory(state, action.grantId, (directory) =>
        isCurrent(directory.scan, action.requestId)
          ? {
              ...directory,
              scan: { status: "error", requestId: action.requestId, error: action.error },
            }
          : directory,
      );
    case "fileRequested":
      return patchDirectory(state, action.grantId, (directory) => ({
        ...directory,
        files: {
          ...directory.files,
          [action.path]: { status: "loading", requestId: action.requestId },
        },
      }));
    case "fileLoaded":
      return patchDirectory(state, action.grantId, (directory) =>
        isCurrentFile(directory.files[action.path], action.requestId)
          ? {
              ...directory,
              files: {
                ...directory.files,
                [action.path]: {
                  status: "loaded",
                  requestId: action.requestId,
                  outcome: action.outcome,
                },
              },
            }
          : directory,
      );
    case "fileFailed":
      return patchDirectory(state, action.grantId, (directory) =>
        isCurrentFile(directory.files[action.path], action.requestId)
          ? {
              ...directory,
              files: {
                ...directory.files,
                [action.path]: { status: "error", requestId: action.requestId, error: action.error },
              },
            }
          : directory,
      );
    case "fileFilterChanged":
      return patchDirectory(state, action.grantId, (directory) => ({
        ...directory,
        fileFilter: action.path,
      }));
  }
}

function isCurrent(scan: DirectoryScan, requestId: number): boolean {
  return scan.status === "loading" && scan.requestId === requestId;
}

function isCurrentFile(file: DirectoryFile | undefined, requestId: number): boolean {
  return file !== undefined && file.status === "loading" && file.requestId === requestId;
}

export function directoryOf(state: DotenvWorkspaceState, grantId: string | undefined): DirectoryState {
  return (grantId === undefined ? undefined : state.directories[grantId]) ?? EMPTY_DIRECTORY;
}

/** Tab labels use the folder name; equal names get their parent folder added. */
export function directoryTabLabels(
  grants: readonly DirectoryGrant[],
): { id: string; label: string; title: string }[] {
  const parts = grants.map((grant) =>
    grant.displayPath.replace(/\/+$/, "").split("/").filter((part) => part !== ""),
  );
  const names = parts.map((segments) => segments[segments.length - 1] ?? "/");
  return grants.map((grant, index) => {
    const segments = parts[index] ?? [];
    const name = names[index] ?? grant.displayPath;
    const duplicated = names.filter((other) => other === name).length > 1;
    const parent = segments[segments.length - 2];
    const label = duplicated && parent !== undefined ? `${parent}/${name}` : name;
    return { id: grant.id, label, title: grant.displayPath };
  });
}

/**
 * Variables of every file that was read, or only the filtered file. Files that
 * could not be read are returned separately, so the list can say what is missing.
 */
export function directoryVariableSources(
  directory: DirectoryState,
): { readable: DotenvFileRows[]; unreadable: string[]; pending: number } {
  const order = directory.scan.status === "ready" ? directory.scan.outcome.files.map((file) => file.relativePath) : [];
  const readable: DotenvFileRows[] = [];
  const unreadable: string[] = [];
  let pending = 0;
  for (const path of order) {
    if (directory.fileFilter !== undefined && path !== directory.fileFilter) continue;
    const file = directory.files[path];
    if (file === undefined || file.status === "loading") {
      pending += 1;
    } else if (file.status === "error" || file.outcome.status !== "READY") {
      unreadable.push(path);
    } else {
      readable.push({
        relativePath: path,
        rows: file.outcome.file.rows,
        truncated: file.outcome.file.rowsTruncated,
      });
    }
  }
  return { readable, unreadable, pending };
}
