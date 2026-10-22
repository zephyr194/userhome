import { useEffect, useState } from "react";
import { decodeAppError, type AppError } from "../../ipc/core";
import { listServices, type ServiceSummary } from "../../ipc/services";

export type ServiceOverview =
  | { status: "loading" }
  | { status: "ready"; services: readonly ServiceSummary[]; loadedAt: number }
  | { status: "error"; error: AppError };

let serviceCache:
  | { refreshId: string; services: readonly ServiceSummary[]; loadedAt: number }
  | undefined;

export function clearServiceOverviewCache(): void {
  serviceCache = undefined;
}

/**
 * Lists services once per discovery refresh. A later visit to the overview reuses the
 * list from the same refresh, so opening the page does not read services again.
 */
export function useServiceOverview(refreshId?: string): ServiceOverview {
  const [result, setResult] = useState<{ refreshId?: string; overview: ServiceOverview }>({
    overview: { status: "loading" },
  });

  useEffect(() => {
    if (refreshId === undefined || serviceCache?.refreshId === refreshId) return;
    let disposed = false;
    void listServices().then(
      (services) => {
        if (disposed) return;
        const loadedAt = Date.now();
        serviceCache = { refreshId, services, loadedAt };
        setResult({ refreshId, overview: { status: "ready", services, loadedAt } });
      },
      (error: unknown) => {
        if (!disposed) {
          setResult({ refreshId, overview: { status: "error", error: decodeAppError(error) } });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [refreshId]);

  if (refreshId === undefined) return { status: "loading" };
  if (serviceCache?.refreshId === refreshId) {
    return { status: "ready", services: serviceCache.services, loadedAt: serviceCache.loadedAt };
  }
  return result.refreshId === refreshId ? result.overview : { status: "loading" };
}
