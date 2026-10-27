import { AsyncState } from "../../components/AsyncState";
import {
  Panel,
  StatusBadge,
  type StatusBadgeProps,
} from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { useT } from "../../i18n/useLocale";
import type {
  OperationStatus,
  OperationSummary,
} from "../../ipc/operations";

const STATUS_LABEL_KEYS: Record<OperationSummary["status"], MessageKey> = {
  PREVIEWED: "operations.history.status.PREVIEWED",
  RUNNING: "operations.history.status.RUNNING",
  CANCELLING: "operations.history.status.CANCELLING",
  SUCCEEDED: "operations.history.status.SUCCEEDED",
  FAILED: "operations.history.status.FAILED",
  CANCELLED: "operations.history.status.CANCELLED",
  EXPIRED: "operations.history.status.EXPIRED",
};

const STATUS_TONES: Record<OperationStatus, StatusBadgeProps["tone"]> = {
  PREVIEWED: "neutral",
  RUNNING: "warning",
  CANCELLING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "danger",
};

export function OperationHistory({
  emptyMessage,
  operations,
  title,
}: {
  emptyMessage?: string;
  operations: readonly OperationSummary[];
  title?: string;
}) {
  const t = useT();
  return (
    <Panel
      className="min-h-0 p-ui-16"
      aria-labelledby="operation-history-heading"
    >
      <p className="text-xs font-semibold text-primary">
        {t("operations.history.eyebrow")}
      </p>
      <div className="mt-ui-4 flex items-center justify-between gap-ui-12">
        <h3 id="operation-history-heading" className="text-lg font-semibold">
          {title ?? t("operations.history.title")}
        </h3>
        <StatusBadge>
          {t("operations.history.count", { count: operations.length })}
        </StatusBadge>
      </div>
      {operations.length === 0 ? (
        <AsyncState kind="empty">
          {emptyMessage ?? t("operations.history.empty")}
        </AsyncState>
      ) : (
        <div
          className="mt-ui-16 max-h-64 overflow-y-auto overscroll-contain rounded-control"
          aria-label={t("operations.history.listLabel")}
          tabIndex={0}
        >
          <ul className="divide-y divide-border">
            {operations.map((operation) => (
              <li
                key={operation.operationId}
                className="flex items-start justify-between gap-ui-12 bg-surface px-ui-12 py-ui-12"
              >
                <span className="min-w-0 text-sm leading-relaxed">
                  {operation.summary}
                </span>
                <StatusBadge
                  className="shrink-0"
                  tone={STATUS_TONES[operation.status]}
                >
                  {t(STATUS_LABEL_KEYS[operation.status])}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
