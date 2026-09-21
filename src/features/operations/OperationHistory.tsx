import { AsyncState } from "../../components/AsyncState";
import {
  Panel,
  StatusBadge,
  type StatusBadgeProps,
} from "../../components/ui";
import type {
  OperationStatus,
  OperationSummary,
} from "../../ipc/operations";

const STATUS_LABELS: Record<OperationSummary["status"], string> = {
  PREVIEWED: "等待确认",
  RUNNING: "进行中",
  CANCELLING: "正在取消",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
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
  emptyMessage = "暂无配置操作。",
  operations,
  title = "配置历史",
}: {
  emptyMessage?: string;
  operations: readonly OperationSummary[];
  title?: string;
}) {
  return (
    <Panel
      className="min-h-0 p-4"
      aria-labelledby="operation-history-heading"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        操作记录
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h3 id="operation-history-heading" className="text-lg font-semibold">
          {title}
        </h3>
        <StatusBadge>{operations.length} 项</StatusBadge>
      </div>
      {operations.length === 0 ? (
        <AsyncState kind="empty">{emptyMessage}</AsyncState>
      ) : (
        <div
          className="mt-4 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border"
          aria-label="配置操作历史，可滚动"
          tabIndex={0}
        >
          <ul className="divide-y divide-border">
            {operations.map((operation) => (
              <li
                key={operation.operationId}
                className="flex items-start justify-between gap-3 bg-surface px-3 py-2.5"
              >
                <span className="min-w-0 text-sm leading-relaxed">
                  {operation.summary}
                </span>
                <StatusBadge
                  className="shrink-0"
                  tone={STATUS_TONES[operation.status]}
                >
                  {STATUS_LABELS[operation.status]}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
