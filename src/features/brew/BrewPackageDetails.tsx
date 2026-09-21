import { useEffect, useRef, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import {
  executeBrewAction,
  getBrewPackage,
  previewBrewAction,
  type BrewPackageAction,
  type BrewPackageDetails as BrewPackageDetailsValue,
  type BrewSearchResult,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  getOperation,
  type OperationDetails,
  type OperationPreview,
} from "../../ipc/operations";
import { BrewActionDialog } from "./BrewActionDialog";

type DetailsState =
  | { status: "loading" }
  | { status: "ready"; details: BrewPackageDetailsValue }
  | { status: "error"; error: AppError };

export function BrewPackageDetails({
  details,
  headingId = "package-details-heading",
  onAction,
}: {
  details: BrewPackageDetailsValue;
  headingId?: string;
  onAction: (action: BrewPackageAction) => void;
}) {
  const installed = details.installedVersions.length > 0;

  return (
    <section
      className="min-w-0 rounded-md border border-border bg-surface"
      aria-labelledby={headingId}
    >
      <header className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              软件包详情
            </p>
            <h3
              className="mt-1 break-words text-base font-semibold"
              id={headingId}
            >
              {details.displayName}
            </h3>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {details.identifier}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge>
              {details.kind === "FORMULA" ? "Formula" : "Cask"}
            </StatusBadge>
            <StatusBadge tone={installed ? "success" : "neutral"}>
              {installed ? "已安装" : "未安装"}
            </StatusBadge>
            {details.outdated ? (
              <StatusBadge tone="warning">可更新</StatusBadge>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-w-0 space-y-4 px-4 py-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {details.description ?? "Homebrew 未提供描述。"}
        </p>
        <dl className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">当前版本</dt>
            <dd className="mt-1 break-all text-sm font-medium">
              {details.currentVersion ?? "未知"}
            </dd>
          </div>
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">已安装版本</dt>
            <dd className="mt-1 break-all text-sm font-medium">
              {details.installedVersions.join(", ") || "未安装"}
            </dd>
          </div>
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">更新状态</dt>
            <dd className="mt-1 text-sm font-medium">
              {details.outdated
                ? "有新版本可用"
                : installed
                  ? "已是最新版本"
                  : "安装后可检查更新"}
            </dd>
          </div>
        </dl>

        {details.homepage ? (
          <p className="min-w-0 break-all text-xs text-muted-foreground">
            主页：{details.homepage}
          </p>
        ) : null}

        <div
          className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"
          aria-label={`${details.displayName} 可用操作`}
        >
          {!installed ? (
            <Button variant="primary" onClick={() => onAction("INSTALL")}>
              安装 {details.kind === "FORMULA" ? "Formula" : "Cask"}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={!details.outdated}
                onClick={() => onAction("UPGRADE")}
              >
                {details.outdated ? "更新软件包" : "无需更新"}
              </Button>
              <Button
                variant="danger"
                onClick={() => onAction("UNINSTALL")}
              >
                卸载 {details.identifier}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function BrewPackageInspector({
  idPrefix = "brew-package",
  onChanged,
  onSelectionRemoved,
  refreshId,
  selected,
}: {
  idPrefix?: string;
  onChanged: () => void;
  onSelectionRemoved?: (selection: BrewSearchResult) => void;
  refreshId?: string;
  selected: BrewSearchResult;
}) {
  const [detailsState, setDetailsState] = useState<DetailsState>({
    status: "loading",
  });
  const [preview, setPreview] = useState<{
    action: BrewPackageAction;
    value: OperationPreview;
  }>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const [removeOnClose, setRemoveOnClose] = useState(false);
  const detailsRequestRef = useRef(0);
  const operationInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    const requestId = detailsRequestRef.current + 1;
    detailsRequestRef.current = requestId;
    void getBrewPackage(selected.kind, selected.identifier)
      .then((details) => {
        if (active && detailsRequestRef.current === requestId) {
          setDetailsState({ status: "ready", details });
        }
      })
      .catch((error) => {
        if (active && detailsRequestRef.current === requestId) {
          setDetailsState({ status: "error", error: decodeAppError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [refreshId, selected.identifier, selected.kind]);

  async function createPreview(action: BrewPackageAction) {
    if (detailsState.status !== "ready") return;
    setActionError(undefined);
    setOperation(undefined);
    setRemoveOnClose(false);
    try {
      const value = await previewBrewAction({
        action,
        kind: detailsState.details.kind,
        identifier: detailsState.details.identifier,
      });
      setPreview({ action, value });
    } catch (error) {
      setActionError(decodeAppError(error));
    }
  }

  async function confirmAction() {
    if (!preview || operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await executeBrewAction(preview.value.operationId);
      setOperation(result);
      if (
        preview.action === "UNINSTALL" &&
        result.status === "SUCCEEDED"
      ) {
        setRemoveOnClose(true);
      }
      onChanged();
      const requestId = detailsRequestRef.current + 1;
      detailsRequestRef.current = requestId;
      try {
        const details = await getBrewPackage(
          selected.kind,
          selected.identifier,
        );
        if (detailsRequestRef.current === requestId) {
          setDetailsState({ status: "ready", details });
        }
      } catch (error) {
        if (detailsRequestRef.current === requestId) {
          setActionError(decodeAppError(error));
        }
      }
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
      onChanged();
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  function closePreview() {
    if (removeOnClose) {
      onSelectionRemoved?.(selected);
    }
    setPreview(undefined);
    setOperation(undefined);
    setActionError(undefined);
    setRemoveOnClose(false);
  }

  return (
    <div className="brew-package-inspector">
      {detailsState.status === "loading" ? (
        <AsyncState kind="loading">正在加载详情…</AsyncState>
      ) : detailsState.status === "error" ? (
        <AsyncState kind="error">{detailsState.error.message}</AsyncState>
      ) : (
        <BrewPackageDetails
          details={detailsState.details}
          headingId={`${idPrefix}-details-heading`}
          onAction={(action) => void createPreview(action)}
        />
      )}

      {actionError && !preview ? (
        <AsyncState kind="error">{actionError.message}</AsyncState>
      ) : null}
      {preview ? (
        <BrewActionDialog
          preview={preview.value}
          operation={operation}
          error={actionError}
          busy={busy}
          onConfirm={() => void confirmAction()}
          onCancel={closePreview}
        />
      ) : null}
    </div>
  );
}
