import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import {
  readEnvironmentFile,
  revealEnvironmentValue,
  scanEnvironmentFiles,
  type EnvRow,
} from "../../ipc/environment";
import {
  listGrants,
  revokeGrant,
  selectDirectoryGrant,
} from "../../ipc/grants";
import { EnvironmentView, type EnvironmentViewProps } from "./EnvironmentView";
import {
  INITIAL_ENVIRONMENT_STATE,
  checkSettings,
  environmentReducer,
} from "./environmentModel";

type GrantNotice = EnvironmentViewProps["grantNotice"];

/**
 * Wires the read-only environment view to the backend. Nothing is stored in
 * the browser: authorizations, scan results and revealed values only live in
 * component state, and every response is matched to the request that asked
 * for it.
 */
export function EnvironmentPage() {
  const [state, dispatch] = useReducer(
    environmentReducer,
    INITIAL_ENVIRONMENT_STATE,
  );
  const [addingGrant, setAddingGrant] = useState(false);
  const [grantNotice, setGrantNotice] = useState<GrantNotice>();
  const requestCounter = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadGrants = useCallback(async (preferred?: string) => {
    try {
      const grants = await listGrants();
      dispatch({ type: "grantsLoaded", grants });
      if (preferred) dispatch({ type: "grantSelected", grantId: preferred });
    } catch (error) {
      dispatch({ type: "grantsFailed", error: decodeAppError(error) });
    }
  }, []);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const addGrant = useCallback(async () => {
    setAddingGrant(true);
    setGrantNotice(undefined);
    try {
      const result = await selectDirectoryGrant();
      if (result.status === "CANCELLED") {
        setGrantNotice({ tone: "info", text: "已取消，没有添加授权。" });
      } else {
        await loadGrants(result.grant.id);
      }
    } catch (error) {
      setGrantNotice({ tone: "error", text: decodeAppError(error).message });
    } finally {
      setAddingGrant(false);
    }
  }, [loadGrants]);

  const revoke = useCallback(
    async (grantId: string) => {
      setGrantNotice(undefined);
      try {
        await revokeGrant(grantId);
        setGrantNotice({ tone: "info", text: "授权已撤销。" });
      } catch (error) {
        setGrantNotice({ tone: "error", text: decodeAppError(error).message });
      }
      await loadGrants();
    },
    [loadGrants],
  );

  const scan = useCallback(() => {
    const current = stateRef.current;
    const check = checkSettings(current.patternsText, current.recursive);
    if (!current.selectedGrantId || !check.ok) return;
    const requestId = ++requestCounter.current;
    dispatch({ type: "scanRequested", requestId });
    scanEnvironmentFiles(current.selectedGrantId, check.settings).then(
      (outcome) =>
        dispatch({
          type: "scanSucceeded",
          requestId,
          outcome,
          settings: check.settings,
        }),
      (error: unknown) =>
        dispatch({
          type: "scanFailed",
          requestId,
          error: decodeAppError(error),
        }),
    );
  }, []);

  const selectFile = useCallback((path: string) => {
    const current = stateRef.current;
    if (!current.selectedGrantId || current.scan.status !== "ready") return;
    const requestId = ++requestCounter.current;
    dispatch({ type: "fileRequested", requestId, path });
    readEnvironmentFile(current.selectedGrantId, path, current.scan.settings).then(
      (outcome) => dispatch({ type: "fileLoaded", requestId, outcome }),
      (error: unknown) =>
        dispatch({ type: "fileFailed", requestId, error: decodeAppError(error) }),
    );
  }, []);

  // The plaintext goes straight to the caller (LazySecretValue) and is never
  // kept in page state.
  const loadValue = useCallback(
    (row: Extract<EnvRow, { kind: "ENTRY" }>) => {
      const current = stateRef.current;
      if (
        !current.selectedGrantId ||
        current.scan.status !== "ready" ||
        current.file.status !== "loaded"
      ) {
        return Promise.reject({
          code: "CONFLICT",
          message: "文件已变化，请重新选择文件。",
          retryable: false,
        });
      }
      return revealEnvironmentValue(
        current.selectedGrantId,
        current.file.path,
        current.scan.settings,
        { line: row.line, key: row.key },
      );
    },
    [],
  );

  return (
    <EnvironmentView
      addingGrant={addingGrant}
      grantNotice={grantNotice}
      onAddGrant={() => void addGrant()}
      onLoadValue={loadValue}
      onPatternsChange={(text) => dispatch({ type: "patternsChanged", text })}
      onRecursiveChange={(recursive) =>
        dispatch({ type: "recursiveChanged", recursive })
      }
      onReloadGrants={() => void loadGrants()}
      onRevokeGrant={(grantId) => void revoke(grantId)}
      onScan={scan}
      onSelectFile={selectFile}
      onSelectGrant={(grantId) => dispatch({ type: "grantSelected", grantId })}
      state={state}
    />
  );
}
