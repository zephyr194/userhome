import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { AppError } from "../../ipc/core";
import type { OperationDetails, OperationPreview } from "../../ipc/operations";

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
  return (
    <ConfirmDialog
      busy={busy}
      className="action-dialog"
      onCancel={onCancel}
      titleId="brew-action-heading"
    >
      <p className="section-kicker">待确认 Homebrew 操作</p>
      <h3 id="brew-action-heading">{preview.summary}</h3>
      <ul>
        {preview.effects.map((effect) => (
          <li key={effect}>{effect}</li>
        ))}
      </ul>
      <p>无需管理员权限；确认仅适用于此预览中的类型、标识符和动作。</p>
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
