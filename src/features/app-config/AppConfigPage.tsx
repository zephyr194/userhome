import { useCallback, useEffect, useReducer, useRef } from "react";
import { readAppConfigEntry, listAppConfigEntries } from "../../ipc/appConfig";
import { decodeAppError } from "../../ipc/core";
import {
  INITIAL_APP_CONFIG_STATE,
  appConfigReducer,
  defaultEntryId,
  isKnownEntry,
  type AppConfigState,
} from "./appConfigModel";
import { AppConfigView } from "./AppConfigView";

/**
 * Connects the read-only listing and the per-entry views to the backend. The
 * frontend only ever sends a registry id that the current listing contains.
 * Responses are matched to the request that asked for them, so a slow earlier
 * read cannot replace a newer selection. Nothing is written to browser storage.
 */
export function AppConfigPage({ refreshId }: { refreshId?: string }) {
  const [state, dispatch] = useReducer(appConfigReducer, INITIAL_APP_CONFIG_STATE);
  const stateRef = useRef<AppConfigState>(state);
  const requestCounter = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadList = useCallback(() => {
    dispatch({ type: "listRequested" });
    listAppConfigEntries().then(
      (items) => dispatch({ type: "listLoaded", items }),
      (error: unknown) =>
        dispatch({ type: "listFailed", error: decodeAppError(error) }),
    );
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, refreshId]);

  const selectEntry = useCallback((id: string) => {
    if (!isKnownEntry(stateRef.current, id)) return;
    const requestId = ++requestCounter.current;
    dispatch({ type: "entrySelected", requestId, id });
    readAppConfigEntry(id).then(
      (result) => dispatch({ type: "entryLoaded", requestId, id, result }),
      (error: unknown) =>
        dispatch({
          type: "entryFailed",
          requestId,
          id,
          error: decodeAppError(error),
        }),
    );
  }, []);

  useEffect(() => {
    const id = defaultEntryId(state);
    if (id !== undefined) selectEntry(id);
  }, [state, selectEntry]);

  return (
    <AppConfigView
      detail={state.detail}
      list={state.list}
      onReload={loadList}
      onSelect={selectEntry}
    />
  );
}
