import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { countAuthorizedDirectories, dataHub } from "../../app/dataHub";
import { decodeAppError } from "../../ipc/core";
import {
  readEnvironmentFile,
  revealEnvironmentValue,
  scanEnvironmentFiles,
  type EnvFileOutcome,
  type ScanOutcome,
  type ScanSettings,
} from "../../ipc/environment";
import {
  listGrants,
  revokeGrant,
  selectDirectoryGrant,
  selectSaveLocationGrant,
} from "../../ipc/grants";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import type { EditorTarget } from "./dotenvEditorModel";
import { checkSettings } from "./environmentModel";
import {
  INITIAL_WORKSPACE,
  directoryOf,
  directoryTabLabels,
  workspaceReducer,
  type DirectoryState,
} from "./dotenvDirectoryModel";
import { useDotenvEditor } from "./useDotenvEditor";
import type { DotenvEditFocus, DotenvEditIntent } from "./environmentModel";

export type GrantNotice = { tone: "info" | "error"; text: string } | undefined;

const READ_CONCURRENCY = 4;

/** The directory tab the user left last; it is restored when the page is shown again. */
let rememberedDirectory: string | undefined;

async function runLimited<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * Owns the dotenv level of the environment page: the authorized directories,
 * one scan and one read per listed file for each directory tab, and the editor.
 * Nothing is stored in the browser. Every response is matched to the scan or
 * read that asked for it, so a slow answer never replaces a newer one.
 */
export function useDotenvWorkspace() {
  const t = useT();
  const locale = useLocale();
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_WORKSPACE);
  const [addingGrant, setAddingGrant] = useState(false);
  const [choosingNewFile, setChoosingNewFile] = useState(false);
  const [grantNotice, setGrantNotice] = useState<GrantNotice>();
  const [editFocus, setEditFocus] = useState<DotenvEditFocus>();
  const focusCounter = useRef(0);
  const requestCounter = useRef(0);
  const scanTokens = useRef(new Map<string, number>());
  const editorOpenRef = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadGrants = useCallback(async () => {
    try {
      const grants = await listGrants();
      dataHub.publish("authorizedDirectories", countAuthorizedDirectories(grants));
      dispatch({ type: "grantsLoaded", grants, remembered: rememberedDirectory });
    } catch (error) {
      dispatch({ type: "grantsFailed", error: decodeAppError(error) });
    }
  }, []);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const readFile = useCallback((grantId: string, path: string, settings: ScanSettings, scanId: number) => {
    if (scanTokens.current.get(grantId) !== scanId) return Promise.resolve();
    const requestId = ++requestCounter.current;
    dispatch({ type: "fileRequested", grantId, requestId, path });
    return readEnvironmentFile(grantId, path, settings).then(
      (outcome: EnvFileOutcome) =>
        dispatch({ type: "fileLoaded", grantId, requestId, path, outcome }),
      (error: unknown) =>
        dispatch({ type: "fileFailed", grantId, requestId, path, error: decodeAppError(error) }),
    );
  }, []);

  const scan = useCallback(
    (grantId: string) => {
      const current = stateRef.current;
      const check = checkSettings(current.patternsText, current.recursive);
      if (!check.ok) return;
      const requestId = ++requestCounter.current;
      scanTokens.current.set(grantId, requestId);
      dispatch({ type: "scanRequested", grantId, requestId });
      scanEnvironmentFiles(grantId, check.settings).then(
        (outcome: ScanOutcome) => {
          dispatch({ type: "scanSucceeded", grantId, requestId, outcome, settings: check.settings });
          if (scanTokens.current.get(grantId) !== requestId) return;
          void runLimited(outcome.files, READ_CONCURRENCY, (file) =>
            readFile(grantId, file.relativePath, check.settings, requestId),
          );
        },
        (error: unknown) =>
          dispatch({ type: "scanFailed", grantId, requestId, error: decodeAppError(error) }),
      );
    },
    [readFile],
  );

  // A directory tab is scanned the first time it is shown; after that its result stays.
  useEffect(() => {
    const grantId = state.selectedGrantId;
    if (grantId !== undefined && state.directories[grantId] === undefined) scan(grantId);
  }, [scan, state.selectedGrantId, state.directories]);

  const selectGrant = useCallback(
    (grantId: string) => {
      if (editorOpenRef.current) return;
      rememberedDirectory = grantId;
      dispatch({ type: "grantSelected", grantId });
    },
    [],
  );

  const addGrant = useCallback(async () => {
    setAddingGrant(true);
    setGrantNotice(undefined);
    try {
      const result = await selectDirectoryGrant();
      if (result.status === "CANCELLED") {
        setGrantNotice({ tone: "info", text: t("env.dotenv.grant.cancelled") });
      } else {
        rememberedDirectory = result.grant.id;
        await loadGrants();
      }
    } catch (error) {
      setGrantNotice({ tone: "error", text: localizeError(decodeAppError(error), locale) });
    } finally {
      setAddingGrant(false);
    }
  }, [loadGrants, locale, t]);

  const revoke = useCallback(
    async (grantId: string) => {
      setGrantNotice(undefined);
      try {
        await revokeGrant(grantId);
        setGrantNotice({ tone: "info", text: t("env.dotenv.grant.revoked") });
      } catch (error) {
        setGrantNotice({ tone: "error", text: localizeError(decodeAppError(error), locale) });
      }
      await loadGrants();
    },
    [loadGrants, locale, t],
  );

  const reloadAfterSave = useCallback(
    (target: EditorTarget) => {
      const grantId = stateRef.current.selectedGrantId;
      if (target.kind !== "existing" || grantId === undefined) return;
      const scanId = scanTokens.current.get(grantId);
      if (scanId !== undefined) void readFile(grantId, target.path, target.settings, scanId);
    },
    [readFile],
  );
  const editor = useDotenvEditor(reloadAfterSave);
  const editorPhase = editor.state.phase;
  useEffect(() => {
    editorOpenRef.current = editorPhase !== "closed";
  }, [editorPhase]);

  const editRow = useCallback(
    (grantId: string, path: string, intent: DotenvEditIntent) => {
      const directory = directoryOf(stateRef.current, grantId);
      const file = directory.files[path];
      if (
        directory.scan.status !== "ready" ||
        file?.status !== "loaded" ||
        file.outcome.status !== "READY"
      ) {
        return;
      }
      editor.controller.openExisting({
        grantId,
        path,
        settings: directory.scan.settings,
        file: file.outcome.file,
      });
      if (intent.kind === "addition") editor.controller.addRow();
      setEditFocus({ id: ++focusCounter.current, target: intent });
    },
    [editor.controller],
  );

  const newFile = useCallback(async () => {
    setChoosingNewFile(true);
    setGrantNotice(undefined);
    try {
      const result = await selectSaveLocationGrant();
      if (result.status === "CANCELLED") {
        setGrantNotice({ tone: "info", text: t("env.dotenv.newFile.cancelled") });
      } else {
        editor.controller.openNew({
          grantId: result.grant.id,
          displayPath: result.grant.displayPath,
        });
      }
    } catch (error) {
      setGrantNotice({ tone: "error", text: localizeError(decodeAppError(error), locale) });
    } finally {
      setChoosingNewFile(false);
    }
  }, [editor.controller, locale, t]);

  // The plaintext goes straight to the caller (LazySecretValue) and is never kept in page state.
  const loadValue = useCallback(
    (grantId: string, row: { key: string; line: number; path: string }) => {
      const directory = directoryOf(stateRef.current, grantId);
      if (directory.scan.status !== "ready") {
        return Promise.reject({
          code: "CONFLICT",
          message: t("env.dotenv.changed"),
          retryable: false,
        });
      }
      return revealEnvironmentValue(grantId, row.path, directory.scan.settings, {
        line: row.line,
        key: row.key,
      });
    },
    [t],
  );

  const rescan = useCallback(() => {
    const grantId = stateRef.current.selectedGrantId;
    if (grantId !== undefined) scan(grantId);
  }, [scan]);

  const selectedGrant = (() => {
    const grants = state.grants.status === "ready" ? state.grants.grants : [];
    return grants.find((grant) => grant.id === state.selectedGrantId);
  })();
  const directory: DirectoryState = directoryOf(state, state.selectedGrantId);

  return {
    addingGrant,
    choosingNewFile,
    directory,
    editFocus,
    editor,
    grantNotice,
    selectedGrant,
    state,
    tabs: state.grants.status === "ready" ? directoryTabLabels(state.grants.grants) : [],
    actions: {
      addGrant: () => void addGrant(),
      editRow: (path: string, line: number) => {
        if (state.selectedGrantId !== undefined) {
          editRow(state.selectedGrantId, path, { kind: "entry", line });
        }
      },
      addVariable: (path: string) => {
        if (state.selectedGrantId !== undefined) {
          editRow(state.selectedGrantId, path, { kind: "addition" });
        }
      },
      loadValue: (path: string, key: string, line: number) =>
        loadValue(state.selectedGrantId ?? "", { key, line, path }),
      newFile: () => void newFile(),
      reloadGrants: () => void loadGrants(),
      revokeGrant: (grantId: string) => void revoke(grantId),
      rescan,
      selectFile: (path: string | undefined) => {
        if (state.selectedGrantId === undefined) return;
        dispatch({ type: "fileFilterChanged", grantId: state.selectedGrantId, path });
      },
      selectGrant,
      setPatterns: (text: string) => dispatch({ type: "patternsChanged", text }),
      setRecursive: (recursive: boolean) => dispatch({ type: "recursiveChanged", recursive }),
    },
  };
}

export type DotenvWorkspace = ReturnType<typeof useDotenvWorkspace>;
