import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppShell } from "./app/AppShell";
import { registerRefreshRequestListener } from "./app/refreshEvents";
import { initialShellState, shellReducer } from "./app/shellState";
import { listManagedApps } from "./ipc/catalog";
import { type AppError, getAppStatus } from "./ipc/core";
import {
  getSystemSnapshot,
  refreshSystemSnapshot,
} from "./ipc/discovery";
import {
  getOperation,
  listOperations,
  type OperationDetails,
} from "./ipc/operations";

async function getRecentOperation(): Promise<OperationDetails | null> {
  const operations = await listOperations();
  return operations[0] ? getOperation(operations[0].operationId) : null;
}

function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShellState);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const reloadShell = useCallback((): Promise<void> => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    dispatch({ type: "refresh-started" });

    const discoveryRefresh = refreshSystemSnapshot();
    const request = Promise.all([
      getAppStatus()
        .then((appStatus) => {
          dispatch({ type: "connection-ready", appStatus });
          return true;
        })
        .catch((error: AppError) => {
          dispatch({ type: "connection-error", error });
          return false;
        }),
      getRecentOperation()
        .then((operation) => {
          dispatch(
            operation
              ? { type: "operation-ready", operation }
              : { type: "operation-empty" },
          );
          return true;
        })
        .catch((error: AppError) => {
          dispatch({ type: "operation-error", error });
          return false;
        }),
      listManagedApps()
        .then((catalog) => {
          dispatch({ type: "applications-ready", catalog });
          return true;
        })
        .catch((error: AppError) => {
          dispatch({ type: "applications-error", error });
          return false;
        }),
      getSystemSnapshot()
        .then((snapshot) => {
          dispatch({ type: "discovery-ready", snapshot });
          return true;
        })
        .catch((error: AppError) => {
          dispatch({ type: "discovery-error", error });
          return false;
        }),
      discoveryRefresh
        .then((snapshot) => {
          dispatch({ type: "discovery-ready", snapshot });
          return !(
            snapshot.system.status === "ERROR" &&
            snapshot.brew.status === "ERROR" &&
            snapshot.candidates.status === "ERROR"
          );
        })
        .catch((error: AppError) => {
          dispatch({ type: "discovery-error", error });
          return false;
        }),
    ])
      .then(
        ([
          connectionReady,
          operationReady,
          applicationsReady,
          localDiscoveryReady,
          refreshReady,
        ]) => {
        if (
          connectionReady &&
          operationReady &&
          applicationsReady &&
          localDiscoveryReady &&
          refreshReady
        ) {
          dispatch({
            type: "refresh-finished",
            completedAt: new Date().toISOString(),
          });
          return;
        }

        dispatch({
          type: "refresh-error",
          message: "刷新完成，但部分信息不可用。",
        });
      },
      )
      .finally(() => {
        refreshInFlight.current = null;
      });

    refreshInFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    void reloadShell();
  }, [reloadShell]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void registerRefreshRequestListener(() => {
      void reloadShell();
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {
        if (!disposed) {
          dispatch({
            type: "refresh-error",
            message: "无法监听托盘刷新请求。",
          });
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reloadShell]);

  return <AppShell onRefresh={reloadShell} state={state} />;
}

export default App;
