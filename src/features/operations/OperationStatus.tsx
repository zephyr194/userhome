import type { ReactNode } from "react";
import type { RecentOperationState } from "../../app/shellState";
import { StatusBadge } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { localizeAppErrorMessage } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import type {
  OperationDetails,
  OperationEvent,
  OperationStatus as OperationStatusValue,
} from "../../ipc/operations";

function latestEvent(operation: OperationDetails): OperationEvent | undefined {
  return operation.events[operation.events.length - 1];
}

const STATUS_DETAILS: Record<
  OperationStatusValue,
  {
    labelKey: MessageKey;
    tone: "neutral" | "success" | "warning" | "danger";
  }
> = {
  PREVIEWED: { labelKey: "operations.recent.status.PREVIEWED", tone: "warning" },
  RUNNING: { labelKey: "operations.recent.status.RUNNING", tone: "warning" },
  CANCELLING: { labelKey: "operations.recent.status.CANCELLING", tone: "warning" },
  SUCCEEDED: { labelKey: "operations.recent.status.SUCCEEDED", tone: "success" },
  FAILED: { labelKey: "operations.recent.status.FAILED", tone: "danger" },
  CANCELLED: { labelKey: "operations.recent.status.CANCELLED", tone: "neutral" },
  EXPIRED: { labelKey: "operations.recent.status.EXPIRED", tone: "neutral" },
};

function OperationIcon({
  kind,
}: {
  kind: "empty" | "error" | "loading" | "operation";
}) {
  if (kind === "error") {
    return (
      <svg
        className="size-4 shrink-0 text-danger"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 3 2.5 17h15L10 3Z" />
        <path d="M10 7.5v4M10 14.5h.01" />
      </svg>
    );
  }

  if (kind === "loading") {
    return (
      <svg
        className="size-4 shrink-0 animate-spin text-warning"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M17 10a7 7 0 1 1-2.05-4.95" />
      </svg>
    );
  }

  if (kind === "empty") {
    return (
      <svg
        className="size-4 shrink-0 text-muted-foreground"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5h12M4 10h8M4 15h5" />
      </svg>
    );
  }

  return (
    <svg
      className="size-4 shrink-0 text-primary"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3v4l3 2" />
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

function OperationRow({
  busy = false,
  children,
  kind,
  status,
  tone = "neutral",
}: {
  busy?: boolean;
  children: ReactNode;
  kind: "empty" | "error" | "loading" | "operation";
  status: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const t = useT();
  return (
    <section
      className="dashboard-status-row"
      aria-labelledby="operations-heading"
      aria-busy={busy || undefined}
    >
      <OperationIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-ui-12">
          <h4 id="operations-heading" className="text-xs font-semibold">
            {t("operations.recent.heading")}
          </h4>
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>
        {children}
      </div>
    </section>
  );
}

export function OperationStatus({ state }: { state: RecentOperationState }) {
  const t = useT();
  const locale = useLocale();
  if (state.status === "loading") {
    return (
      <OperationRow
        busy
        kind="loading"
        status={t("operations.recent.loading")}
        tone="warning"
      >
        <p
          className="mt-ui-4 text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {t("operations.recent.loadingText")}
        </p>
      </OperationRow>
    );
  }

  if (state.status === "error") {
    return (
      <OperationRow
        kind="error"
        status={t("operations.recent.loadFailed")}
        tone="danger"
      >
        <p className="mt-ui-4 text-xs leading-relaxed text-danger" role="alert">
          {localizeAppErrorMessage(state.error, locale)}
        </p>
      </OperationRow>
    );
  }

  if (state.status === "empty") {
    return (
      <OperationRow kind="empty" status={t("operations.recent.idle")}>
        <p className="mt-ui-4 text-xs leading-relaxed text-muted-foreground">
          {t("operations.recent.empty")}
        </p>
      </OperationRow>
    );
  }

  const { operation } = state;
  const event = latestEvent(operation);
  const status = STATUS_DETAILS[operation.status];
  const statusLabel = t(status.labelKey);
  const message =
    event?.type === "progress"
      ? event.message
      : event?.type === "finished"
        ? event.status === "FAILED"
          ? event.error?.message ?? event.stdoutSummary ?? event.stderrSummary
          : event.stdoutSummary ?? event.stderrSummary ?? event.error?.message
        : undefined;

  const truncation = [
    operation.droppedEvents
      ? t("operations.recent.droppedEvents", { count: operation.droppedEvents })
      : undefined,
    operation.droppedRecords
      ? t("operations.recent.droppedRecords", { count: operation.droppedRecords })
      : undefined,
  ].filter((note): note is string => note !== undefined);

  return (
    <OperationRow
      kind={operation.status === "FAILED" ? "error" : "operation"}
      status={statusLabel}
      tone={status.tone}
    >
      <p className="mt-ui-4 text-xs font-medium leading-relaxed">
        {operation.summary}
      </p>
      {operation.status === "CANCELLING" ? (
        <p
          className="mt-ui-4 text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {t("operations.recent.cancelling")}
        </p>
      ) : null}
      {message ? (
        <p className="mt-ui-4 text-xs leading-relaxed text-muted-foreground">
          {message}
        </p>
      ) : null}
      {truncation.length > 0 ? (
        <p className="mt-ui-4 text-xs leading-relaxed text-muted-foreground">
          {t("operations.recent.notes", {
            notes: truncation.join(t("operations.recent.noteSeparator")),
          })}
        </p>
      ) : null}
    </OperationRow>
  );
}
