import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge } from "../../components/ui";
import type { AppError } from "../../ipc/core";
import type {
  OperationDetails,
  OperationPreview,
  OperationStatus,
} from "../../ipc/operations";

const STATUS_LABELS: Record<OperationStatus, string> = {
  PREVIEWED: "等待确认",
  RUNNING: "正在执行",
  CANCELLING: "正在取消",
  SUCCEEDED: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
  EXPIRED: "预览已过期",
};

const STATUS_TONES: Record<
  OperationStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  PREVIEWED: "neutral",
  RUNNING: "warning",
  CANCELLING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "danger",
};

export function BrewActionDialog({
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
  const canConfirm = !operation || operation.status === "PREVIEWED";

  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="brew-action-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            待确认 Homebrew 操作
          </p>
          <h3 className="break-words" id="brew-action-heading">
            {preview.summary}
          </h3>
        </div>
        <StatusBadge
          tone={operation ? STATUS_TONES[operation.status] : "neutral"}
        >
          {operation ? STATUS_LABELS[operation.status] : "等待确认"}
        </StatusBadge>
      </div>

      <section
        className="rounded-md border border-border bg-surface-muted px-3.5 py-3"
        aria-labelledby="brew-effects-heading"
      >
        <h4
          className="text-xs font-semibold text-foreground"
          id="brew-effects-heading"
        >
          本次操作影响
        </h4>
        <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
          {preview.effects.map((effect) => (
            <li className="flex gap-2" key={effect}>
              <span className="text-primary" aria-hidden="true">
                •
              </span>
              <span className="min-w-0 break-words">{effect}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        无需管理员权限；确认仅适用于此预览中的类型、标识符和动作。
      </p>

      {busy ? (
        <div
          className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
          role="status"
          aria-live="polite"
        >
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
          Homebrew 正在执行，窗口会在完成后显示结果。
        </div>
      ) : null}

      {operation ? (
        <section
          className="rounded-md border border-border px-3.5 py-3"
          aria-labelledby="brew-result-heading"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold" id="brew-result-heading">
              操作结果
            </h4>
            <StatusBadge tone={STATUS_TONES[operation.status]}>
              {STATUS_LABELS[operation.status]}
            </StatusBadge>
          </div>
          {operation.events.length > 0 ? (
            <ol className="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs">
              {operation.events.map((event) => (
                <li
                  className="rounded bg-surface-muted px-2.5 py-2 text-muted-foreground"
                  key={`${event.sequence}-${event.type}`}
                >
                  {event.type === "progress" ? (
                    event.message
                  ) : (
                    <>
                      <strong className="font-medium text-foreground">
                        {STATUS_LABELS[event.status]}
                      </strong>
                      {event.stdoutSummary ? (
                        <p className="mt-1 whitespace-pre-wrap break-words">
                          {event.stdoutSummary}
                        </p>
                      ) : null}
                      {event.stderrSummary ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-danger">
                          {event.stderrSummary}
                        </p>
                      ) : null}
                      {event.error ? (
                        <p className="mt-1 break-words text-danger">
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
              Homebrew 未返回额外输出。
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        {canConfirm ? (
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
          {operation && !canConfirm ? "关闭" : "取消"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}
