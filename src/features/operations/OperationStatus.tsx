import type { RecentOperationState } from "../../app/shellState";
import type {
  OperationDetails,
  OperationEvent,
  OperationStatus as OperationStatusValue,
} from "../../ipc/operations";

function latestEvent(operation: OperationDetails): OperationEvent | undefined {
  return operation.events[operation.events.length - 1];
}

const STATUS_LABELS: Record<OperationStatusValue, string> = {
  PREVIEWED: "等待确认",
  RUNNING: "进行中",
  CANCELLING: "正在取消",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

export function OperationStatus({ state }: { state: RecentOperationState }) {
  if (state.status === "loading") {
    return (
      <section
        className="status-card"
        aria-labelledby="operations-heading"
        aria-live="polite"
      >
        <div className="status-card__heading">
          <h2 id="operations-heading">最近操作</h2>
          <span className="status-dot status-dot--pending" aria-hidden="true" />
        </div>
        <p role="status" aria-live="polite" aria-busy="true">
          正在读取操作记录…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="status-card" aria-labelledby="operations-heading">
        <div className="status-card__heading">
          <h2 id="operations-heading">最近操作</h2>
          <span className="status-dot status-dot--error" aria-hidden="true" />
        </div>
        <p role="alert">{state.error.message}</p>
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section className="status-card" aria-labelledby="operations-heading">
        <div className="status-card__heading">
          <h2 id="operations-heading">最近操作</h2>
          <span className="status-dot" aria-hidden="true" />
        </div>
        <p>暂无操作记录。</p>
      </section>
    );
  }

  const { operation } = state;
  const event = latestEvent(operation);
  const message =
    event?.type === "progress"
      ? event.message
      : event?.type === "finished"
        ? event.stdoutSummary ?? event.stderrSummary
        : undefined;

  return (
    <section className="status-card" aria-labelledby="operations-heading">
      <div className="status-card__heading">
        <h2 id="operations-heading">最近操作</h2>
        <span
          className={`status-dot status-dot--${operation.status === "SUCCEEDED" ? "ok" : operation.status === "FAILED" ? "error" : "pending"}`}
          aria-hidden="true"
        />
      </div>
      <p>{operation.summary}</p>
      <p className="status-note">状态：{STATUS_LABELS[operation.status]}</p>
      {message && <p className="operation-message">{message}</p>}
    </section>
  );
}
