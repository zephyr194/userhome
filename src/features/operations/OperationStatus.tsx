import type { ReactNode } from "react";
import type { RecentOperationState } from "../../app/shellState";
import { StatusBadge } from "../../components/ui";
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
    label: string;
    tone: "neutral" | "success" | "warning" | "danger";
  }
> = {
  PREVIEWED: { label: "等待确认", tone: "warning" },
  RUNNING: { label: "进行中", tone: "warning" },
  CANCELLING: { label: "正在取消", tone: "warning" },
  SUCCEEDED: { label: "已完成", tone: "success" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  EXPIRED: { label: "已过期", tone: "neutral" },
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
  return (
    <section
      className="dashboard-status-row"
      aria-labelledby="operations-heading"
      aria-busy={busy || undefined}
    >
      <OperationIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h4 id="operations-heading" className="text-xs font-semibold">
            最近操作
          </h4>
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>
        {children}
      </div>
    </section>
  );
}

export function OperationStatus({ state }: { state: RecentOperationState }) {
  if (state.status === "loading") {
    return (
      <OperationRow busy kind="loading" status="读取中" tone="warning">
        <p
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          正在读取操作记录…
        </p>
      </OperationRow>
    );
  }

  if (state.status === "error") {
    return (
      <OperationRow kind="error" status="读取失败" tone="danger">
        <p className="mt-1 text-xs leading-relaxed text-danger" role="alert">
          {state.error.message}
        </p>
      </OperationRow>
    );
  }

  if (state.status === "empty") {
    return (
      <OperationRow kind="empty" status="空闲">
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          暂无操作记录。
        </p>
      </OperationRow>
    );
  }

  const { operation } = state;
  const event = latestEvent(operation);
  const status = STATUS_DETAILS[operation.status];
  const message =
    event?.type === "progress"
      ? event.message
      : event?.type === "finished"
        ? event.stdoutSummary ?? event.stderrSummary ?? event.error?.message
        : undefined;

  return (
    <OperationRow
      kind={operation.status === "FAILED" ? "error" : "operation"}
      status={status.label}
      tone={status.tone}
    >
      <p className="mt-1 text-xs font-medium leading-relaxed">
        {operation.summary}
      </p>
      {message ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {message}
        </p>
      ) : null}
    </OperationRow>
  );
}
