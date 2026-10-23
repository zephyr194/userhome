import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import {
  readZshStartupFiles,
  revealZshValue,
  type ZshEntryRow,
  type ZshFileKey,
} from "../../ipc/environment";
import { selectDirectoryGrant } from "../../ipc/grants";
import { useZshEditor } from "./useZshEditor";
import { ZshEditor } from "./ZshEditor";
import { ZshView, type ZshViewProps } from "./ZshView";
import {
  INITIAL_ZSH_STATE,
  zshReducer,
  type ZshEditFocus,
  type ZshEditIntent,
} from "./zshModel";

type Notice = ZshViewProps["notice"];

/**
 * Wires the zsh view and the managed-block editor to the backend. Nothing is
 * stored in the browser: the overview, the directory the user chose for an
 * undetermined `ZDOTDIR`, revealed values and editor drafts only live in
 * component state, and every response is matched to the request that asked for
 * it. Editing happens inside this page (the editor replaces the read-only view
 * while it is open); there is no new navigation entry.
 */
export function ZshPage() {
  const [state, dispatch] = useReducer(zshReducer, INITIAL_ZSH_STATE);
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const requestCounter = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback((grantId?: string) => {
    const requestId = ++requestCounter.current;
    dispatch({ type: "loadRequested", requestId });
    readZshStartupFiles(grantId).then(
      (overview) => dispatch({ type: "loaded", requestId, overview }),
      (error: unknown) =>
        dispatch({ type: "loadFailed", requestId, error: decodeAppError(error) }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    setNotice(undefined);
    load(stateRef.current.zdotdirGrantId);
  }, [load]);

  // After a save ran (or failed in a way that may have changed the file), the
  // read-only view must show what the files contain now.
  const onSaved = useCallback(() => {
    load(stateRef.current.zdotdirGrantId);
  }, [load]);
  const editor = useZshEditor(onSaved);
  const [editFocus, setEditFocus] = useState<ZshEditFocus>();
  const focusCounter = useRef(0);
  const openEditor = useCallback(
    (file: ZshFileKey, intent?: ZshEditIntent) => {
      const zdotdirGrantId = stateRef.current.zdotdirGrantId;
      setEditFocus(
        intent === undefined ? undefined : { id: ++focusCounter.current, target: intent },
      );
      void editor.controller
        .open({
          file,
          ...(zdotdirGrantId === undefined ? {} : { zdotdirGrantId }),
        })
        .then(() => {
          const current = editor.controller.getState();
          if (
            intent?.kind === "addition" &&
            current.phase === "editing" &&
            current.loaded?.enabled
          ) {
            editor.controller.addVariable();
          }
        });
    },
    [editor.controller],
  );

  // The native picker names the directory; the backend only accepts one below
  // the home folder and turns it into a directory authorization.
  const chooseDirectory = useCallback(async () => {
    setChoosing(true);
    setNotice(undefined);
    try {
      const result = await selectDirectoryGrant();
      if (result.status === "CANCELLED") {
        setNotice({ tone: "info", text: "已取消，没有选择目录。" });
      } else {
        dispatch({ type: "directoryChosen", grantId: result.grant.id });
        load(result.grant.id);
      }
    } catch (error) {
      setNotice({ tone: "error", text: decodeAppError(error).message });
    } finally {
      setChoosing(false);
    }
  }, [load]);

  const clearDirectory = useCallback(() => {
    setNotice(undefined);
    dispatch({ type: "directoryCleared" });
    load();
  }, [load]);

  // The plaintext goes straight to the caller (LazySecretValue) and is never
  // kept in page state.
  const loadValue = useCallback(
    (file: ZshFileKey, row: ZshEntryRow) =>
      revealZshValue(
        { file, line: row.line, name: row.name },
        stateRef.current.zdotdirGrantId,
      ),
    [],
  );

  if (editor.state.phase !== "closed") {
    return (
      <ZshEditor
        actions={editor.controller}
        check={editor.check}
        focus={editFocus}
        state={editor.state}
      />
    );
  }
  return (
    <ZshView
      choosing={choosing}
      notice={notice}
      onChooseDirectory={() => void chooseDirectory()}
      onClearDirectory={clearDirectory}
      onEditFile={openEditor}
      onLoadValue={loadValue}
      onReload={reload}
      state={state}
    />
  );
}
