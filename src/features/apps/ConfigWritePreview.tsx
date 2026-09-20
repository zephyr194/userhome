import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { ConfigWritePreview as ConfigWritePreviewValue } from "../../ipc/config";

export function ConfigWritePreview({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ConfigWritePreviewValue;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      className="config-preview"
      onCancel={onCancel}
      titleId="config-preview-heading"
    >
      <p className="section-kicker">待确认操作</p>
      <h3 id="config-preview-heading">{preview.summary}</h3>
      <ul>
        {preview.effects.map((effect) => (
          <li key={effect}>{effect}</li>
        ))}
      </ul>
      {preview.diff.redacted && <p>敏感内容已从差异中隐藏。</p>}
      {preview.diff.lines.length > 0 && (
        <pre className="config-diff">
          {preview.diff.lines.map((line, index) => (
            <span key={`${line.kind}-${index}`} className={`diff-line diff-line--${line.kind.toLowerCase()}`}>
              {line.kind === "ADDED" ? "+" : "-"} {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {preview.diff.truncated && <p>差异过大，仅显示安全上限内的内容。</p>}
      {preview.requiresElevation && (
        <p>此写入需要已签名且已获批准的 privileged helper；否则将安全拒绝。</p>
      )}
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={onConfirm}>
          确认并写入
        </button>
        <button
          className="secondary-button"
          type="button"
          data-dialog-cancel
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </ConfirmDialog>
  );
}
