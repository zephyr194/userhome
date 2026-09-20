import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge, type StatusBadgeProps } from "../../components/ui";
import type { ConfigWritePreview as ConfigWritePreviewValue } from "../../ipc/config";
import type { AppError } from "../../ipc/core";
import type {
  OperationDetails,
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

const STATUS_TONES: Record<OperationStatus, StatusBadgeProps["tone"]> = {
  PREVIEWED: "neutral",
  RUNNING: "warning",
  CANCELLING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "danger",
};

export function ConfigWritePreview({
  preview,
  kind = "write",
  operation,
  error,
  busy = false,
  onConfirm,
  onCancel,
}: {
  preview: ConfigWritePreviewValue;
  kind?: "write" | "restore";
  operation?: OperationDetails;
  error?: AppError;
  busy?: boolean;
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
      titleId="config-preview-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {kind === "restore" ? "待确认恢复操作" : "待确认配置写入"}
          </p>
          <h3 className="break-words" id="config-preview-heading">
            {preview.summary}
          </h3>
        </div>
        <StatusBadge tone={STATUS_TONES[status]}>
          {STATUS_LABELS[status]}
        </StatusBadge>
      </div>

      <section
        className="rounded-md border border-border bg-surface-muted px-3.5 py-3"
        aria-labelledby="config-effects-heading"
      >
        <h4 className="text-sm font-semibold" id="config-effects-heading">
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

      <section aria-labelledby="config-diff-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold" id="config-diff-heading">
            安全差异预览
          </h4>
          <span className="text-xs text-muted-foreground">
            到期时间：
            <time dateTime={preview.expiresAt}>
              {new Date(preview.expiresAt).toLocaleString("zh-CN")}
            </time>
          </span>
        </div>
        {preview.diff.redacted ? (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            敏感内容已从差异中隐藏。
          </p>
        ) : null}
        {preview.diff.lines.length > 0 ? (
          <pre
            aria-label="配置差异，可滚动"
            className="mt-2 max-h-72 min-w-0 overflow-auto overscroll-contain rounded-md bg-neutral-950 p-3 font-mono text-xs leading-relaxed whitespace-pre text-neutral-100"
            tabIndex={0}
          >
            {preview.diff.lines.map((line, index) => (
              <span
                className={
                  line.kind === "ADDED"
                    ? "block text-emerald-300"
                    : "block text-rose-300"
                }
                key={`${line.kind}-${index}`}
              >
                {line.kind === "ADDED" ? "+" : "-"} {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        ) : (
          <p className="mt-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            此操作没有可显示的文本差异。
          </p>
        )}
        {preview.diff.truncated ? (
          <p className="mt-2 text-xs text-muted-foreground">
            差异过大，仅显示安全上限内的内容。
          </p>
        ) : null}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {preview.requiresElevation
          ? "此操作需要已签名且已获批准的 privileged helper；helper 不可用或未获授权时将安全拒绝。"
          : "确认仅授权当前预览中的配置、内容哈希与操作类型。配置已被并发修改时将安全拒绝。"}
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
          {kind === "restore" ? "正在恢复备份…" : "正在写入配置…"}
        </div>
      ) : null}

      {operation ? (
        <section
          className="rounded-md border border-border px-3.5 py-3"
          aria-labelledby="config-result-heading"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold" id="config-result-heading">
              操作结果
            </h4>
            <StatusBadge tone={STATUS_TONES[operation.status]}>
              {STATUS_LABELS[operation.status]}
            </StatusBadge>
          </div>
          {operation.events.length > 0 ? (
            <ol className="mt-3 max-h-40 space-y-2 overflow-y-auto overscroll-contain text-xs">
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
              操作未返回额外输出。
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
            disabled={busy}
            variant="primary"
            onClick={onConfirm}
          >
            {busy
              ? "正在执行…"
              : kind === "restore"
                ? "确认恢复"
                : "确认并写入"}
          </Button>
        ) : null}
        <Button
          type="button"
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
