import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { AppError } from "../../ipc/core";
import type { OperationDetails, OperationPreview } from "../../ipc/operations";

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
  return (
    <ConfirmDialog
      busy={busy}
      className="action-dialog"
      onCancel={onCancel}
      titleId="service-action-heading"
    >
      <p className="section-kicker">待确认服务操作</p>
      <h3 id="service-action-heading">{preview.summary}</h3>
      <ul>
        {preview.effects.map((effect) => (
          <li key={effect}>{effect}</li>
        ))}
      </ul>
      <p>
        {preview.requiresElevation
          ? "此确认仅授权当前系统级服务动作；签名 helper 不可用或未获批准时将拒绝执行。"
          : "此确认仅授权当前用户级服务动作，不使用提权。"}
      </p>
      {operation ? <p role="status">操作状态：{operation.status}</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
      <div className="dialog-actions">
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "正在执行…" : "确认执行"}
        </button>
        <button
          className="secondary-button"
          type="button"
          data-dialog-cancel
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </ConfirmDialog>
  );
}
