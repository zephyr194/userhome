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
        className="size-4 text-danger"
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
        className="size-4 animate-spin text-warning"
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
        className="size-4 text-muted-foreground"
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
      className="size-4 text-primary"
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

export function OperationStatus({ state }: { state: RecentOperationState }) {
  if (state.status === "loading") {
    return (
      <section
        className="px-4 py-4"
        aria-labelledby="operations-heading"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <OperationIcon kind="loading" />
            <h3 id="operations-heading" className="text-xs font-semibold">
              最近操作
            </h3>
          </div>
          <StatusBadge tone="warning">读取中</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs leading-relaxed text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          正在读取操作记录…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="px-4 py-4" aria-labelledby="operations-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <OperationIcon kind="error" />
            <h3 id="operations-heading" className="text-xs font-semibold">
              最近操作
            </h3>
          </div>
          <StatusBadge tone="danger">读取失败</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs leading-relaxed text-danger"
          role="alert"
        >
          {state.error.message}
        </p>
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section className="px-4 py-4" aria-labelledby="operations-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <OperationIcon kind="empty" />
            <h3 id="operations-heading" className="text-xs font-semibold">
              最近操作
            </h3>
          </div>
          <StatusBadge>空闲</StatusBadge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          暂无操作记录。
        </p>
      </section>
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
    <section className="px-4 py-4" aria-labelledby="operations-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <OperationIcon
            kind={operation.status === "FAILED" ? "error" : "operation"}
          />
          <h3 id="operations-heading" className="text-xs font-semibold">
            最近操作
          </h3>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug">
        {operation.summary}
      </p>
      {message ? (
        <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
