import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge, type StatusBadgeProps } from "../../components/ui";
import type { AppError } from "../../ipc/core";
import type { ServiceAction } from "../../ipc/services";
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

const ACTION_LABELS: Record<ServiceAction, string> = {
  START: "启动",
  STOP: "停止",
  RESTART: "重启",
};

export function ServiceActionDialog({
  action,
  preview,
  serviceId,
  operation,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  action?: ServiceAction;
  preview: OperationPreview;
  serviceId?: string;
  operation?: OperationDetails;
  error?: AppError;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const status = operation?.status ?? (busy ? "RUNNING" : "PREVIEWED");
  const canConfirm = operation === undefined;

  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="service-action-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {action ? `待确认${ACTION_LABELS[action]}` : "待确认服务操作"}
          </p>
          <h3
            className="break-words [overflow-wrap:anywhere]"
            id="service-action-heading"
          >
            {preview.summary}
          </h3>
          {serviceId ? (
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              目标服务：{serviceId}
            </p>
          ) : null}
        </div>
        <StatusBadge className="shrink-0" tone={STATUS_TONES[status]}>
          {STATUS_LABELS[status]}
        </StatusBadge>
      </div>

      <section
        className="rounded-control border border-border bg-surface-muted px-3.5 py-3"
        aria-labelledby="service-effects-heading"
      >
        <h4 className="text-sm font-semibold" id="service-effects-heading">
          本次操作影响
        </h4>
        <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
          {preview.effects.map((effect) => (
            <li className="flex gap-2" key={effect}>
              <span className="text-primary" aria-hidden="true">
                •
              </span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {effect}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {preview.requiresElevation
          ? "此确认仅授权当前系统级服务动作；签名 helper 不可用或未获批准时将拒绝执行。"
          : "此确认仅授权当前用户级服务动作，不使用提权。"}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        预览到期：
        <time dateTime={preview.expiresAt}>
          {new Date(preview.expiresAt).toLocaleString("zh-CN")}
        </time>
      </p>

      {busy ? (
        <div
          className="flex items-center gap-2 rounded-control border border-warning-border bg-warning-soft px-3 py-2.5 text-sm text-warning"
          role="status"
          aria-live="polite"
        >
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
          服务操作正在执行，窗口会在完成后显示结果。
        </div>
      ) : null}

      {operation ? (
        <section
          className="rounded-control border border-border px-3.5 py-3"
          aria-labelledby="service-result-heading"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold" id="service-result-heading">
              操作结果
            </h4>
            <StatusBadge tone={STATUS_TONES[operation.status]}>
              {STATUS_LABELS[operation.status]}
            </StatusBadge>
          </div>
          {operation.events.length > 0 ? (
            <ol
              className="mt-3 max-h-40 space-y-2 overflow-y-auto overscroll-contain text-xs"
              aria-label="服务操作进度，可滚动"
              tabIndex={0}
            >
              {operation.events.map((event) => (
                <li
                  className="rounded-control bg-surface-muted px-2.5 py-2 text-muted-foreground"
                  key={`${event.sequence}-${event.type}`}
                >
                  {event.type === "progress" ? (
                    <span className="break-words [overflow-wrap:anywhere]">
                      {event.message}
                    </span>
                  ) : (
                    <>
                      <strong className="font-medium text-foreground">
                        {STATUS_LABELS[event.status]}
                      </strong>
                      {event.stdoutSummary ? (
                        <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {event.stdoutSummary}
                        </p>
                      ) : null}
                      {event.stderrSummary ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-danger [overflow-wrap:anywhere]">
                          {event.stderrSummary}
                        </p>
                      ) : null}
                      {event.error ? (
                        <p className="mt-1 break-words text-danger [overflow-wrap:anywhere]">
                          {event.error.message}
                        </p>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              服务管理器未返回额外输出。
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <p
          className="break-words rounded-control border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger [overflow-wrap:anywhere]"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-4">
        {canConfirm ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? "正在执行…"
              : action
                ? `确认${ACTION_LABELS[action]}`
                : "确认执行"}
          </Button>
        ) : null}
        <Button
          data-dialog-cancel
          disabled={busy}
          onClick={onCancel}
        >
          {operation ? "关闭" : "取消"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}
