import { useState } from "react";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  SettingsConfirmationDialog,
  SettingsDangerZone,
  SettingsFeedback,
  SettingsFieldList,
  SettingsForm,
  SettingsValueField,
} from "./SettingsPrimitives";

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
    <SettingsConfirmationDialog
      action={
        !error ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在重置…" : "确认重置偏好"}
          </Button>
        ) : undefined
      }
      busy={busy}
      cancelLabel={error ? "关闭" : "取消"}
      error={error?.message}
      errorStatus="重置失败"
      eyebrow="待确认偏好重置"
      onCancel={onCancel}
      status={busy ? "正在重置" : "等待确认"}
      title="恢复 UserHome 安全默认值？"
      titleId="preferences-reset-heading"
    >
      <Panel
        className="bg-surface-muted p-ui-2xl"
        aria-labelledby="preferences-reset-effects-heading"
      >
        <h4
          className="text-xs font-semibold"
          id="preferences-reset-effects-heading"
        >
          本次操作影响
        </h4>
        <ul className="mt-ui-md mb-0 list-disc space-y-ui-xs pl-5 text-muted-foreground">
          <li>外观、生命周期、刷新、编辑器和发现根偏好恢复默认。</li>
          <li>所有 UserHome 配置备份保持不变。</li>
          <li>所有受管应用配置文件和服务保持不变。</li>
        </ul>
      </Panel>
    </SettingsConfirmationDialog>
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
    <SettingsForm busy={busy}>
      <SettingsFieldList>
        <SettingsValueField
          label="偏好设置"
          description="恢复版本化、经过验证的 UserHome 默认值。"
        >
          恢复默认
        </SettingsValueField>
        <SettingsValueField
          label="配置备份"
          description="不会删除；清理备份始终使用单独的预览和确认流程。"
        >
          <StatusBadge tone="success">保留</StatusBadge>
        </SettingsValueField>
        <SettingsValueField
          label="受管配置"
          description="不会修改应用配置文件、服务或 catalog 授权。"
        >
          <StatusBadge tone="success">保留</StatusBadge>
        </SettingsValueField>
      </SettingsFieldList>

      <SettingsDangerZone
        title="重置偏好"
        description="此操作会立即更新当前外观和发现设置，并在下次启动继续使用默认值；不会删除备份或修改受管配置。"
      >
        <Button
          size="sm"
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
      </SettingsDangerZone>

      <SettingsFeedback status={status} />

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
    </SettingsForm>
  );
}
