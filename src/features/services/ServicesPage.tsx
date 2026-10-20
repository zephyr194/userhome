import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { decodeAppError } from "../../ipc/core";
import {
  listLaunchdServices,
  listServices,
  type CreateServiceExecution,
} from "../../ipc/services";
import { CreateServiceDialog } from "./CreateServiceDialog";
import {
  DISCOVERY_REFRESH_MIN_INTERVAL_MS,
  EMPTY_FILTER,
  INITIAL_DISCOVERY_STATE,
  canStartRefresh,
  discoveryReducer,
  type EvidenceState,
  type ServiceFilter,
} from "./launchdModel";
import { ServicesView } from "./ServicesView";

/**
 * launchd inventory. The discovered tasks are read-only; the one write entry is
 * creating a new UserHome-owned task, which only adds a configuration file and
 * neither loads nor starts it. The list, the filters and the selection live
 * only in memory; the selection is keyed by domain + label so a refresh keeps
 * it, and a vanished task is reported instead of replaced.
 */
export function ServicesPage({
  initialSelectedServiceId,
  onSelectedServiceChange,
  refreshId,
}: {
  initialSelectedServiceId?: string;
  onSelectedServiceChange?: (serviceId?: string) => void;
  refreshId?: string;
}) {
  const [state, dispatch] = useReducer(
    discoveryReducer,
    INITIAL_DISCOVERY_STATE,
  );
  const [evidence, setEvidence] = useState<EvidenceState>({
    status: "loading",
  });
  const [filter, setFilter] = useState<ServiceFilter>(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState(initialSelectedServiceId);
  const [cooling, setCooling] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<string | undefined>();
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastStartedRef = useRef<number | undefined>(undefined);
  const coolingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const selectionChangeRef = useRef(onSelectedServiceChange);

  useEffect(() => {
    selectionChangeRef.current = onSelectedServiceChange;
  }, [onSelectedServiceChange]);

  const load = useCallback(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    inFlightRef.current = true;
    lastStartedRef.current = Date.now();
    dispatch({ type: "refreshStarted" });
    void listLaunchdServices()
      .then((discovery) => {
        if (requestRef.current !== requestId) return;
        inFlightRef.current = false;
        dispatch({ type: "loaded", discovery });
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return;
        inFlightRef.current = false;
        dispatch({ type: "failed", error: decodeAppError(error) });
      });
    // Homebrew is evidence only; its failure must not touch the launchd list.
    void listServices()
      .then((summaries) => {
        if (requestRef.current === requestId) {
          setEvidence({ status: "ready", summaries });
        }
      })
      .catch(() => {
        if (requestRef.current === requestId) {
          setEvidence({ status: "unavailable" });
        }
      });
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshId]);

  useEffect(
    () => () => {
      requestRef.current += 1;
      clearTimeout(coolingTimerRef.current);
    },
    [],
  );

  const refresh = useCallback(() => {
    if (
      !canStartRefresh({
        inFlight: inFlightRef.current,
        lastStartedAt: lastStartedRef.current,
        now: Date.now(),
      })
    ) {
      return;
    }
    setCooling(true);
    clearTimeout(coolingTimerRef.current);
    coolingTimerRef.current = setTimeout(
      () => setCooling(false),
      DISCOVERY_REFRESH_MIN_INTERVAL_MS,
    );
    load();
  }, [load]);

  // A new file changes what discovery sees, so the list is read again at once
  // (not throttled); the notice stays until the user dismisses it.
  const created = useCallback(
    (execution: CreateServiceExecution) => {
      setCreatedNotice(
        `已创建 ${execution.label}：新任务尚未加载，也未启动。`,
      );
      load();
    },
    [load],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    selectionChangeRef.current?.(id);
  }, []);

  return (
    <>
      <ServicesView
        state={state}
        evidence={evidence}
        filter={filter}
        selectedId={selectedId}
        refreshDisabled={
          cooling ||
          state.status === "loading" ||
          (state.status === "ready" && state.refreshing)
        }
        onFilterChange={setFilter}
        onSelect={select}
        onRefresh={refresh}
        headerActions={
          <div className="grid min-w-0 justify-items-end gap-ui-xs">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setCreatedNotice(undefined);
                setCreateOpen(true);
              }}
            >
              创建自建任务
            </Button>
            {createdNotice ? (
              <p
                className="max-w-xs break-words text-right text-xs text-success [overflow-wrap:anywhere]"
                role="status"
                aria-live="polite"
              >
                {createdNotice}{" "}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreatedNotice(undefined)}
                >
                  知道了
                </Button>
              </p>
            ) : null}
          </div>
        }
      />
      {createOpen ? (
        <CreateServiceDialog
          onClose={() => setCreateOpen(false)}
          onCreated={created}
        />
      ) : null}
    </>
  );
}
