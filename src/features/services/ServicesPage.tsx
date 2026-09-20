import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import {
  Button,
  Panel,
  StatusBadge,
  type StatusBadgeProps,
} from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import { getOperation, type OperationDetails, type OperationPreview } from "../../ipc/operations";
import {
  executeServiceAction,
  getService,
  listServices,
  previewServiceAction,
  type ServiceAction,
  type ServiceDetails as ServiceDetailsValue,
  type ServiceSummary,
} from "../../ipc/services";
import { ServiceActionDialog } from "./ServiceActionDialog";
import { ServiceDetails } from "./ServiceDetails";

type ListState =
  | { status: "loading" }
  | { status: "ready"; services: readonly ServiceSummary[] }
  | { status: "error"; error: AppError };

const STATE_LABELS: Record<ServiceSummary["state"], string> = {
  STARTED: "运行中",
  STOPPED: "已停止",
  ERROR: "错误",
  UNKNOWN: "未知",
};

const STATE_TONES: Record<
  ServiceSummary["state"],
  StatusBadgeProps["tone"]
> = {
  STARTED: "success",
  STOPPED: "neutral",
  ERROR: "danger",
  UNKNOWN: "warning",
};

const SCOPE_LABELS: Record<ServiceSummary["scope"], string> = {
  USER: "用户级",
  SYSTEM: "系统级",
  UNKNOWN: "未知作用域",
};

export function ServicesPage({
  onOperationChanged,
  refreshId,
}: {
  onOperationChanged?: () => void;
  refreshId?: string;
}) {
  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [details, setDetails] = useState<ServiceDetailsValue>();
  const [detailsError, setDetailsError] = useState<AppError>();
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [preview, setPreview] = useState<OperationPreview>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [busy, setBusy] = useState(false);

  async function refreshServices() {
    setListState({ status: "loading" });
    try {
      const services = await listServices();
      setListState({ status: "ready", services });
      if (details) {
        try {
          setDetails(await getService(details.serviceId));
          setDetailsError(undefined);
        } catch (error) {
          setDetailsError(decodeAppError(error));
        }
      }
    } catch (error) {
      setListState({ status: "error", error: decodeAppError(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void listServices()
      .then((services) => {
        if (!cancelled) {
          setListState({ status: "ready", services });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListState({ status: "error", error: decodeAppError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshId]);

  async function loadDetails(serviceId: string) {
    setDetailsError(undefined);
    setDetailsLoading(true);
    setPreview(undefined);
    try {
      setDetails(await getService(serviceId));
    } catch (error) {
      setDetailsError(decodeAppError(error));
    } finally {
      setDetailsLoading(false);
    }
  }

  async function createPreview(action: ServiceAction) {
    if (!details) return;
    setActionError(undefined);
    setOperation(undefined);
    try {
      setPreview(
        await previewServiceAction({ action, serviceId: details.serviceId }),
      );
    } catch (error) {
      setActionError(decodeAppError(error));
    }
  }

  async function confirmAction() {
    if (!preview) return;
    setBusy(true);
    setActionError(undefined);
    try {
      setOperation(await executeServiceAction(preview.operationId));
    } catch (error) {
      setActionError(decodeAppError(error));
      try {
        setOperation(await getOperation(preview.operationId));
      } catch {
        setOperation(undefined);
      }
    } finally {
      await refreshServices();
      onOperationChanged?.();
      setBusy(false);
    }
  }

  return (
    <Panel
      className="min-h-0 overflow-hidden p-5"
      aria-labelledby="services-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Homebrew services
          </p>
          <h2
            id="services-heading"
            className="mt-1 text-xl font-semibold tracking-tight"
          >
            服务清单
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            查看用户级和系统级服务；只读服务不会提供变更操作。
          </p>
        </div>
        {listState.status === "ready" ? (
          <div className="flex flex-wrap justify-end gap-2" aria-label="服务统计">
            <StatusBadge>
              用户级{" "}
              {
                listState.services.filter((service) => service.scope === "USER")
                  .length
              }
            </StatusBadge>
            <StatusBadge>
              系统级{" "}
              {
                listState.services.filter(
                  (service) => service.scope === "SYSTEM",
                ).length
              }
            </StatusBadge>
            <StatusBadge tone="warning">
              只读{" "}
              {
                listState.services.filter((service) => !service.manageable)
                  .length
              }
            </StatusBadge>
          </div>
        ) : null}
      </div>

      {listState.status === "loading" ? (
        <AsyncState kind="loading">正在刷新服务状态…</AsyncState>
      ) : listState.status === "error" ? (
        <AsyncState kind="error">{listState.error.message}</AsyncState>
      ) : listState.services.length === 0 ? (
        <AsyncState kind="empty">没有发现 Homebrew 服务。</AsyncState>
      ) : (
        <div className="mt-5 grid min-h-0 gap-4 lg:grid-cols-2">
          <section
            className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-muted"
            aria-labelledby="service-inventory-heading"
          >
            <div className="border-b border-border px-4 py-3">
              <h3
                id="service-inventory-heading"
                className="text-sm font-semibold"
              >
                已发现 {listState.services.length} 项服务
              </h3>
            </div>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain">
              {listState.services.map((service) => {
                const selected = details?.serviceId === service.serviceId;
                return (
                  <li
                    key={service.serviceId}
                    className={selected ? "bg-primary-soft" : "bg-surface"}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm">
                          {service.displayName}
                        </strong>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {service.user ?? service.status}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusBadge tone={STATE_TONES[service.state]}>
                            {STATE_LABELS[service.state]}
                          </StatusBadge>
                          <StatusBadge>
                            {SCOPE_LABELS[service.scope]}
                          </StatusBadge>
                          {!service.manageable ? (
                            <StatusBadge tone="warning">只读</StatusBadge>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        aria-pressed={selected}
                        size="sm"
                        onClick={() => void loadDetails(service.serviceId)}
                      >
                        查看详情
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="min-w-0">
            {detailsLoading ? (
              <AsyncState kind="loading">正在加载服务详情…</AsyncState>
            ) : detailsError ? (
              <AsyncState kind="error">{detailsError.message}</AsyncState>
            ) : details ? (
              <ServiceDetails
                details={details}
                onAction={(action) => void createPreview(action)}
              />
            ) : (
              <AsyncState kind="empty">
                从服务清单中选择一项以查看作用域、状态和可用操作。
              </AsyncState>
            )}
          </div>
        </div>
      )}
      {actionError && !preview ? (
        <AsyncState kind="error">{actionError.message}</AsyncState>
      ) : null}
      {preview ? (
        <ServiceActionDialog
          preview={preview}
          operation={operation}
          error={actionError}
          busy={busy}
          onConfirm={() => void confirmAction()}
          onCancel={() => {
            setPreview(undefined);
            setOperation(undefined);
            setActionError(undefined);
          }}
        />
      ) : null}
    </Panel>
  );
}
