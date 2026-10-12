import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { StatusBadge, type StatusBadgeProps } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  getOperation,
  listOperations,
  type OperationDetails,
  type OperationPreview,
  type OperationSummary,
} from "../../ipc/operations";
import { OperationHistory } from "../operations/OperationHistory";
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

type DetailsState =
  | { status: "idle" }
  | { status: "loading"; serviceId: string }
  | {
      status: "ready";
      serviceId: string;
      details: ServiceDetailsValue;
    }
  | { status: "error"; serviceId: string; error: AppError };

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; operations: readonly OperationSummary[] }
  | { status: "error"; error: AppError };

interface ServicePreview {
  action: ServiceAction;
  serviceId: string;
  value: OperationPreview;
}

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

function targetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  itemCount: number,
): number | undefined {
  if (event.key === "ArrowDown") return Math.min(currentIndex + 1, itemCount - 1);
  if (event.key === "ArrowUp") return Math.max(currentIndex - 1, 0);
  if (event.key === "Home") return 0;
  if (event.key === "End") return itemCount - 1;
  return undefined;
}

export function ServicesPage({
  initialSelectedServiceId,
  onOperationChanged,
  onSelectedServiceChange,
  refreshId,
}: {
  initialSelectedServiceId?: string;
  onOperationChanged?: () => void;
  onSelectedServiceChange?: (serviceId?: string) => void;
  refreshId?: string;
}) {
  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [selectedServiceId, setSelectedServiceId] = useState<string | undefined>(
    initialSelectedServiceId,
  );
  const [detailsState, setDetailsState] = useState<DetailsState>({
    status: "idle",
  });
  const [historyState, setHistoryState] = useState<HistoryState>({
    status: "loading",
  });
  const [filter, setFilter] = useState("");
  const [mutationRefresh, setMutationRefresh] = useState(0);
  const [preview, setPreview] = useState<ServicePreview>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const listRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const operationInFlightRef = useRef(false);
  const selectedServiceChangeRef = useRef(onSelectedServiceChange);
  const selectedServiceIdRef = useRef<string | undefined>(
    initialSelectedServiceId,
  );
  const filterInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    selectedServiceChangeRef.current = onSelectedServiceChange;
  }, [onSelectedServiceChange]);

  useEffect(() => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    void listServices()
      .then((services) => {
        if (listRequestRef.current !== requestId) return;
        setListState({ status: "ready", services });
        const current = selectedServiceIdRef.current;
        const next =
          current &&
          services.some((service) => service.serviceId === current)
            ? current
            : services[0]?.serviceId;
        if (next !== current) {
          const restoreFocus =
            current !== undefined &&
            rowRefs.current.get(current) === document.activeElement;
          selectedServiceIdRef.current = next;
          previewRequestRef.current += 1;
          setSelectedServiceId(next);
          setPreview(undefined);
          setOperation(undefined);
          setActionError(undefined);
          selectedServiceChangeRef.current?.(next);
          if (restoreFocus) {
            requestAnimationFrame(() => {
              (
                (next ? rowRefs.current.get(next) : undefined) ??
                rowRefs.current.values().next().value ??
                filterInputRef.current
              )?.focus();
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (listRequestRef.current === requestId) {
          setListState({ status: "error", error: decodeAppError(error) });
        }
      });
  }, [mutationRefresh, refreshId]);

  useEffect(() => {
    if (!selectedServiceId) return;
    const requestId = detailsRequestRef.current + 1;
    detailsRequestRef.current = requestId;
    void getService(selectedServiceId)
      .then((details) => {
        if (detailsRequestRef.current === requestId) {
          setDetailsState({
            status: "ready",
            serviceId: selectedServiceId,
            details,
          });
        }
      })
      .catch((error: unknown) => {
        if (detailsRequestRef.current === requestId) {
          setDetailsState({
            status: "error",
            serviceId: selectedServiceId,
            error: decodeAppError(error),
          });
        }
      });
  }, [mutationRefresh, refreshId, selectedServiceId]);

  useEffect(() => {
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    void listOperations()
      .then((operations) => {
        if (historyRequestRef.current === requestId) {
          setHistoryState({ status: "ready", operations });
        }
      })
      .catch((error: unknown) => {
        if (historyRequestRef.current === requestId) {
          setHistoryState({ status: "error", error: decodeAppError(error) });
        }
      });
  }, [mutationRefresh, refreshId]);

  function selectService(serviceId: string) {
    selectedServiceIdRef.current = serviceId;
    previewRequestRef.current += 1;
    setSelectedServiceId(serviceId);
    selectedServiceChangeRef.current?.(serviceId);
    setPreview(undefined);
    setOperation(undefined);
    setActionError(undefined);
  }

  const allServices = listState.status === "ready" ? listState.services : [];
  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const services = normalizedFilter
    ? allServices.filter((service) =>
        [
          service.displayName,
          service.serviceId,
          service.user,
          service.status,
          SCOPE_LABELS[service.scope],
          STATE_LABELS[service.state],
        ].some((value) =>
          value?.toLocaleLowerCase("zh-CN").includes(normalizedFilter),
        ),
      )
    : allServices;
  const selectedIsVisible = services.some(
    (service) => service.serviceId === selectedServiceId,
  );
  const visibleDetailsState: DetailsState = selectedServiceId
    ? detailsState.status !== "idle" &&
      detailsState.serviceId === selectedServiceId
      ? detailsState
      : { status: "loading", serviceId: selectedServiceId }
    : { status: "idle" };

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const nextIndex = targetIndex(event, currentIndex, services.length);
    if (nextIndex === undefined) return;
    event.preventDefault();
    if (nextIndex === currentIndex) return;
    const nextServiceId = services[nextIndex].serviceId;
    selectService(nextServiceId);
    rowRefs.current.get(nextServiceId)?.focus();
  }

  async function createPreview(action: ServiceAction) {
    if (visibleDetailsState.status !== "ready") return;
    const serviceId = visibleDetailsState.details.serviceId;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setActionError(undefined);
    setOperation(undefined);
    try {
      const nextPreview = await previewServiceAction({ action, serviceId });
      if (
        previewRequestRef.current === requestId &&
        selectedServiceIdRef.current === serviceId
      ) {
        setPreview({ action, serviceId, value: nextPreview });
      }
    } catch (error) {
      if (
        previewRequestRef.current === requestId &&
        selectedServiceIdRef.current === serviceId
      ) {
        setActionError(decodeAppError(error));
      }
    }
  }

  async function confirmAction() {
    if (!preview || operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setActionError(undefined);
    try {
      setOperation(await executeServiceAction(preview.value.operationId));
    } catch (error) {
      const executionError = decodeAppError(error);
      setActionError(executionError);
      try {
        setOperation(await getOperation(preview.value.operationId));
      } catch (operationError) {
        const lookupError = decodeAppError(operationError);
        setOperation(undefined);
        setActionError({
          ...lookupError,
          message: `${executionError.message} 无法读取操作结果：${lookupError.message}`,
          retryable: executionError.retryable || lookupError.retryable,
        });
      }
    } finally {
      operationInFlightRef.current = false;
      setMutationRefresh((current) => current + 1);
      onOperationChanged?.();
      setBusy(false);
    }
  }

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
      aria-labelledby="services-heading"
    >
      <div className="grid min-h-0 overflow-hidden grid-rows-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:grid-cols-[300px_minmax(0,1fr)] sm:grid-rows-1">
        <section
          className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b border-border sm:border-r sm:border-b-0"
          aria-labelledby="services-heading"
        >
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-lg border-b border-border bg-surface-muted px-ui-xl py-ui-md">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold" id="services-heading">
                服务清单
              </h2>
              <p className="mt-ui-xs text-xs text-muted-foreground">
                已发现服务
              </p>
            </div>
            {listState.status === "ready" ? (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                aria-label="服务统计"
              >
                <StatusBadge>
                  用户级{" "}
                  {
                    listState.services.filter(
                      (service) => service.scope === "USER",
                    ).length
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
                    listState.services.filter(
                      (service) =>
                        !service.manageable || service.scope === "UNKNOWN",
                    ).length
                  }
                </StatusBadge>
              </div>
            ) : null}
          </header>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md border-b border-border bg-surface-muted px-ui-xl py-ui-md">
            <label className="min-w-40 flex-1">
              <span className="sr-only">筛选服务</span>
              <input
                ref={filterInputRef}
                className="min-h-control-sm w-full min-w-0 rounded-control border border-border bg-surface px-ui-lg py-ui-sm text-xs text-foreground transition placeholder:text-muted-foreground focus:border-primary focus-visible:shadow-focus"
                type="search"
                maxLength={128}
                placeholder="按名称、标识符、状态或作用域筛选"
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
              />
            </label>
            <span className="shrink-0 text-xs text-muted-foreground" role="status">
              {listState.status === "ready"
                ? `显示 ${services.length} / ${allServices.length} 项`
                : "正在读取本机状态"}
            </span>
          </div>

          {listState.status === "loading" ? (
            <div className="p-3">
              <AsyncState kind="loading">正在刷新服务状态…</AsyncState>
            </div>
          ) : listState.status === "error" ? (
            <div className="p-3">
              <AsyncState kind="error">
                <span className="break-words [overflow-wrap:anywhere]">
                  {listState.error.message}
                </span>
              </AsyncState>
            </div>
          ) : allServices.length === 0 ? (
            <div className="p-3">
              <AsyncState kind="empty">没有发现 Homebrew 服务。</AsyncState>
            </div>
          ) : services.length === 0 ? (
            <div className="p-3">
              <AsyncState kind="empty">没有符合筛选条件的服务。</AsyncState>
            </div>
          ) : (
            <ul
              className="min-h-0 overflow-y-auto overscroll-contain"
              role="listbox"
              aria-label={`Homebrew 服务清单，共 ${services.length} 项`}
            >
              {services.map((service, index) => {
                const isSelected = service.serviceId === selectedServiceId;
                const isTabStop =
                  isSelected || (!selectedIsVisible && index === 0);
                return (
                  <li key={service.serviceId} role="presentation">
                    <button
                      ref={(button) => {
                        if (button) {
                          rowRefs.current.set(service.serviceId, button);
                        } else {
                          rowRefs.current.delete(service.serviceId);
                        }
                      }}
                      className={classNames(
                        "services-inventory-row",
                        isSelected && "services-inventory-row--selected",
                      )}
                      type="button"
                      role="option"
                      aria-label={`${service.displayName}，${SCOPE_LABELS[service.scope]}，${STATE_LABELS[service.state]}，${service.manageable && service.scope !== "UNKNOWN" ? "可管理" : "只读"}`}
                      aria-selected={isSelected}
                      tabIndex={isTabStop ? 0 : -1}
                      title={service.displayName}
                      onClick={() => selectService(service.serviceId)}
                      onKeyDown={(event) => moveSelection(event, index)}
                    >
                      <span className="min-w-0">
                        <strong className="block break-words text-sm font-semibold [overflow-wrap:anywhere]">
                          {service.displayName}
                        </strong>
                        <span className="mt-ui-xs block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {SCOPE_LABELS[service.scope]} ·{" "}
                          {service.manageable && service.scope !== "UNKNOWN"
                            ? "可管理"
                            : "只读"}{" "}
                          ·{" "}
                          {service.user ?? service.status}
                        </span>
                      </span>
                      <StatusBadge
                        className="min-h-5 shrink-0 px-ui-sm py-0 text-[10px]"
                        tone={STATE_TONES[service.state]}
                      >
                        {STATE_LABELS[service.state]}
                      </StatusBadge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-ui-xl overscroll-contain"
          aria-label="服务详情与操作"
        >
          <div className="grid min-w-0 gap-ui-xl">
            {visibleDetailsState.status === "idle" ? (
              <AsyncState kind="empty">
                从服务清单中选择一项以查看作用域、状态和可用操作。
              </AsyncState>
            ) : visibleDetailsState.status === "loading" ? (
              <AsyncState kind="loading">正在加载服务详情…</AsyncState>
            ) : visibleDetailsState.status === "error" ? (
              <AsyncState kind="error">
                <span className="break-words [overflow-wrap:anywhere]">
                  {visibleDetailsState.error.message}
                </span>
              </AsyncState>
            ) : (
              <ServiceDetails
                details={visibleDetailsState.details}
                onAction={(action) => void createPreview(action)}
              />
            )}
            {actionError && !preview ? (
              <AsyncState kind="error">
                <span className="break-words [overflow-wrap:anywhere]">
                  {actionError.message}
                </span>
              </AsyncState>
            ) : null}
            {historyState.status === "loading" ? (
              <AsyncState kind="loading">正在加载操作历史…</AsyncState>
            ) : historyState.status === "error" ? (
              <AsyncState kind="error">
                <span className="break-words [overflow-wrap:anywhere]">
                  {historyState.error.message}
                </span>
              </AsyncState>
            ) : (
              <OperationHistory
                emptyMessage="暂无操作记录。"
                operations={historyState.operations}
                title="最近操作"
              />
            )}
          </div>
        </section>
      </div>

      {preview ? (
        <ServiceActionDialog
          action={preview.action}
          preview={preview.value}
          serviceId={preview.serviceId}
          operation={operation}
          error={actionError}
          busy={busy}
          onConfirm={() => void confirmAction()}
          onCancel={() => {
            previewRequestRef.current += 1;
            setPreview(undefined);
            setOperation(undefined);
            setActionError(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
