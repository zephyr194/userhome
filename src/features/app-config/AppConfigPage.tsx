import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocale } from "../../i18n/useLocale";
import { dataHub } from "../../app/dataHub";
import { readAppConfigEntry, listAppConfigEntries } from "../../ipc/appConfig";
import { decodeAppError } from "../../ipc/core";
import {
  INITIAL_APP_CONFIG_STATE,
  appConfigCopy,
  appConfigReducer,
  defaultEntryId,
  isKnownEntry,
  type AppConfigState,
} from "./appConfigModel";
import { AppConfigView, type AppConfigEditControls } from "./AppConfigView";


/**
 * Connects the listing and the per-entry views to the backend. The frontend only
 * ever sends a registry id that the current listing contains. Responses are
 * matched to the request that asked for them, so a slow earlier read cannot
 * replace a newer selection. Nothing is written to browser storage.
 */
export function AppConfigPage({ refreshId }: { refreshId?: string }) {
  const copy = appConfigCopy(useLocale());
  const [state, dispatch] = useReducer(appConfigReducer, INITIAL_APP_CONFIG_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef<AppConfigState>(state);
  const requestCounter = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadList = useCallback(() => {
    dispatch({ type: "listRequested" });
    listAppConfigEntries().then(
      (items) => {
        dispatch({ type: "listLoaded", items });
        dataHub.publish("appConfig", items.length);
      },
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

  const editing =
    editingId !== null && state.detail.status !== "idle" && state.detail.id === editingId
      ? editingId
      : null;

  const choose = useCallback(
    (id: string) => {
      setNotice(null);
      selectEntry(id);
    },
    [selectEntry],
  );

  const edit: AppConfigEditControls = {
    editingId: editing,
    notice,
    onStart: (id) => {
      setNotice(null);
      setEditingId(id);
    },
    onExit: () => setEditingId(null),
    onSaved: (created) => {
      if (editing !== null) selectEntry(editing);
      setEditingId(null);
      setNotice(created ? copy.t("appConfig.notice.created") : copy.t("appConfig.notice.saved"));
    },
  };

  return (
    <AppConfigView
      detail={state.detail}
      edit={edit}
      list={state.list}
      onReload={loadList}
      onSelect={choose}
    />
  );
}
