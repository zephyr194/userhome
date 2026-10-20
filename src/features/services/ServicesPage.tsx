import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import { listLaunchdServices, listServices } from "../../ipc/services";
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
 * Read-only launchd inventory. The list, the filters and the selection live
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

  const select = useCallback((id: string) => {
    setSelectedId(id);
    selectionChangeRef.current?.(id);
  }, []);

  return (
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
    />
  );
}
