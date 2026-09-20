import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
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
        setDetails(await getService(details.serviceId));
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
    setPreview(undefined);
    try {
      setDetails(await getService(serviceId));
    } catch (error) {
      setDetailsError(decodeAppError(error));
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
    <section className="services-panel" aria-labelledby="services-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Homebrew services</p>
          <h2 id="services-heading">服务清单</h2>
        </div>
      </div>
      {listState.status === "loading" ? (
        <AsyncState kind="loading">正在刷新服务状态…</AsyncState>
      ) : listState.status === "error" ? (
        <AsyncState kind="error">{listState.error.message}</AsyncState>
      ) : listState.services.length === 0 ? (
        <AsyncState kind="empty">没有发现 Homebrew 服务。</AsyncState>
      ) : (
        <ul className="service-list">
          {listState.services.map((service) => (
            <li key={service.serviceId}>
              <span>
                <strong>{service.displayName}</strong>
                <small>
                  {service.scope} · {service.status}
                  {!service.manageable ? " · 只读" : ""}
                </small>
              </span>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void loadDetails(service.serviceId)}
              >
                查看详情
              </button>
            </li>
          ))}
        </ul>
      )}
      {detailsError ? <p role="alert">{detailsError.message}</p> : null}
      {details ? (
        <ServiceDetails
          details={details}
          onAction={(action) => void createPreview(action)}
        />
      ) : null}
      {actionError && !preview ? <p role="alert">{actionError.message}</p> : null}
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
    </section>
  );
}
