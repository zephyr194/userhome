import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";

function ResetConfirmation({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error?: AppError;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="preferences-reset-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-danger">
            待确认偏好重置
          </p>
          <h3 id="preferences-reset-heading">恢复 UserHome 安全默认值？</h3>
        </div>
        <StatusBadge tone={error ? "danger" : "warning"}>
          {error ? "重置失败" : busy ? "正在重置" : "等待确认"}
        </StatusBadge>
      </div>

      <section
        className="rounded-md border border-border bg-surface-muted p-3"
        aria-labelledby="preferences-reset-effects-heading"
      >
        <h4
          className="text-xs font-semibold"
          id="preferences-reset-effects-heading"
        >
          本次操作影响
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>外观、生命周期、刷新、编辑器和发现根偏好恢复默认。</li>
          <li>所有 UserHome 配置备份保持不变。</li>
          <li>所有受管应用配置文件和服务保持不变。</li>
        </ul>
      </section>

      {error ? (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {!error ? (
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? "正在重置…" : "确认重置偏好"}
          </Button>
        ) : null}
        <Button data-dialog-cancel disabled={busy} onClick={onCancel}>
          {error ? "关闭" : "取消"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}

export function ResetSettings({
  onDiscoveryRefresh,
  onReset,
}: {
  onDiscoveryRefresh: () => void;
  onReset: () => Promise<void>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [status, setStatus] = useState<string>();

  async function confirmReset(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onReset();
      setDialogOpen(false);
      setStatus("偏好已恢复安全默认值；备份和受管配置保持不变。");
      onDiscoveryRefresh();
    } catch (caught) {
      setError(decodeAppError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-form" aria-busy={busy}>
      <div className="settings-control-list">
        <div className="settings-control-row">
          <span>
            <strong>偏好设置</strong>
            <small>恢复版本化、经过验证的 UserHome 默认值。</small>
          </span>
          <span className="settings-control-row__value">恢复默认</span>
        </div>
        <div className="settings-control-row">
          <span>
            <strong>配置备份</strong>
            <small>不会删除；清理备份始终使用单独的预览和确认流程。</small>
          </span>
          <StatusBadge tone="success">保留</StatusBadge>
        </div>
        <div className="settings-control-row">
          <span>
            <strong>受管配置</strong>
            <small>不会修改应用配置文件、服务或 catalog 授权。</small>
          </span>
          <StatusBadge tone="success">保留</StatusBadge>
        </div>
      </div>

      <section className="rounded-lg border border-danger/30 bg-danger/5 p-3">
        <h3 className="m-0 text-xs font-semibold text-danger">重置偏好</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          此操作会立即更新当前外观和发现设置，并在下次启动继续使用默认值。
        </p>
        <div className="mt-3 flex justify-end border-t border-danger/20 pt-3">
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setError(undefined);
              setStatus(undefined);
              setDialogOpen(true);
            }}
          >
            重置偏好…
          </Button>
        </div>
      </section>

      {status ? (
        <p className="settings-form__status" role="status">
          {status}
        </p>
      ) : null}

      {dialogOpen ? (
        <ResetConfirmation
          busy={busy}
          error={error}
          onCancel={() => {
            if (busy) return;
            setDialogOpen(false);
            setError(undefined);
          }}
          onConfirm={() => void confirmReset()}
        />
      ) : null}
    </div>
  );
}
