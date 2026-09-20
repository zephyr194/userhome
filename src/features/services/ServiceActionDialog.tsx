import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge, type StatusBadgeProps } from "../../components/ui";
import type { AppError } from "../../ipc/core";
import type {
  OperationDetails,
  OperationPreview,
  OperationStatus,
} from "../../ipc/operations";

const STATUS_LABELS: Record<OperationStatus, string> = {
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

function latestOperationMessage(operation: OperationDetails) {
  const event = operation.events[operation.events.length - 1];
  if (event?.type === "progress") return event.message;
  if (event?.type === "finished") {
    return (
      event.error?.message ??
      event.stderrSummary ??
      event.stdoutSummary
    );
  }
  return undefined;
}

export function ServiceActionDialog({
  preview,
  operation,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: OperationPreview;
  operation?: OperationDetails;
  error?: AppError;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const status = operation?.status ?? (busy ? "RUNNING" : "PREVIEWED");
  const message = operation ? latestOperationMessage(operation) : undefined;
  const finished =
    operation !== undefined &&
    ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(operation.status);

  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="service-action-heading"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        待确认服务操作
      </p>
      <h3 id="service-action-heading">{preview.summary}</h3>
      <div className="rounded-md border border-border bg-surface-muted p-3">
        <p className="font-medium">预计影响</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {preview.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground">
        {preview.requiresElevation
          ? "此确认仅授权当前系统级服务动作；签名 helper 不可用或未获批准时将拒绝执行。"
          : "此确认仅授权当前用户级服务动作，不使用提权。"}
      </p>

      <div
        className="rounded-md border border-border px-3 py-2.5"
        role={status === "FAILED" ? "alert" : "status"}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">操作状态</span>
          <StatusBadge tone={STATUS_TONES[status]}>
            {STATUS_LABELS[status]}
          </StatusBadge>
        </div>
        {message ? (
          <p className="mt-2 text-muted-foreground">{message}</p>
        ) : null}
      </div>

      {error ? (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {!finished ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在执行…" : "确认执行"}
          </Button>
        ) : null}
        <Button
          data-dialog-cancel
          disabled={busy}
          onClick={onCancel}
        >
          {finished ? "关闭" : "取消"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}
