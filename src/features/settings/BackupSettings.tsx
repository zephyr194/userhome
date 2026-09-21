import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import type {
  OperationDetails,
  OperationPreview,
} from "../../ipc/operations";
import {
  executeClearBackups,
  getBackupStorage,
  previewClearBackups,
  type BackupRetention,
  type BackupStorageSummary,
  type UpdatePreferencesRequest,
  type UserPreferences,
} from "../../ipc/settings";

type StorageState =
  | { status: "loading" }
  | { status: "ready"; summary: BackupStorageSummary }
  | { status: "error"; error: AppError };

const RETENTION_OPTIONS = [
  [5, "5 份", "适合较小的本机存储预算。"],
  [10, "10 份", "平衡回滚历史和磁盘占用。"],
  [20, "20 份", "保留最长的受管配置历史。"],
] as const satisfies readonly [BackupRetention, string, string][];

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupClearDialog({
  busy,
  error,
  operation,
  preview,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error?: AppError;
  operation?: OperationDetails;
  preview: OperationPreview;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const finished = operation?.status === "SUCCEEDED";

  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="backup-clear-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-danger">
            待确认备份清理
          </p>
          <h3 id="backup-clear-heading">{preview.summary}</h3>
        </div>
        <StatusBadge tone={error ? "danger" : finished ? "success" : "warning"}>
          {error ? "清理失败" : finished ? "已完成" : busy ? "正在清理" : "等待确认"}
        </StatusBadge>
      </div>

      <section
        className="rounded-md border border-border bg-surface-muted p-3"
        aria-labelledby="backup-clear-effects-heading"
      >
        <h4 className="text-xs font-semibold" id="backup-clear-effects-heading">
          本次操作影响
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {preview.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        确认仅适用于此预览中的 UserHome 备份集合；备份变化后必须重新预览。
      </p>

      {error ? (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {!finished && !error ? (
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? "正在清理…" : "确认清理"}
          </Button>
        ) : null}
        <Button data-dialog-cancel disabled={busy} onClick={onCancel}>
          {finished || error ? "关闭" : "取消"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}

export function BackupSettings({
  onChange,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const [storage, setStorage] = useState<StorageState>({ status: "loading" });
  const [pendingRetention, setPendingRetention] = useState<BackupRetention>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<AppError>();
  const [preview, setPreview] = useState<OperationPreview>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [dialogError, setDialogError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  async function reloadStorage(): Promise<void> {
    try {
      setStorage({ status: "ready", summary: await getBackupStorage() });
    } catch (caught) {
      setStorage({ status: "error", error: decodeAppError(caught) });
    }
  }

  useEffect(() => {
    let active = true;
    void getBackupStorage()
      .then((summary) => {
        if (active) setStorage({ status: "ready", summary });
      })
      .catch((caught) => {
        if (active) {
          setStorage({ status: "error", error: decodeAppError(caught) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function changeRetention(retention: BackupRetention): Promise<void> {
    if (pendingRetention !== undefined) return;
    setPendingRetention(retention);
    setStatus(undefined);
    setError(undefined);
    try {
      await onChange({ backupRetention: retention });
      await reloadStorage();
      setStatus(`已保留每个配置最新的 ${retention} 份备份。`);
    } catch (caught) {
      setError(decodeAppError(caught));
    } finally {
      setPendingRetention(undefined);
    }
  }

  async function openClearPreview(): Promise<void> {
    if (previewing) return;
    setError(undefined);
    setStatus(undefined);
    setPreviewing(true);
    try {
      setPreview(await previewClearBackups());
      setOperation(undefined);
      setDialogError(undefined);
    } catch (caught) {
      setError(decodeAppError(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmClear(): Promise<void> {
    if (!preview || busy) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const completed = await executeClearBackups(preview.operationId);
      setOperation(completed);
      await reloadStorage();
      setStatus("UserHome 备份已清理，受管配置和偏好保持不变。");
    } catch (caught) {
      setDialogError(decodeAppError(caught));
    } finally {
      setBusy(false);
    }
  }

  const selectedRetention =
    pendingRetention ?? preferences.backupRetention;
  const summary = storage.status === "ready" ? storage.summary : undefined;

  return (
    <section
      className="settings-backup"
      aria-busy={busy || previewing || pendingRetention !== undefined}
      aria-labelledby="backup-heading"
    >
      <div>
        <h3 id="backup-heading">配置备份</h3>
        <p>保留策略和清理只作用于 UserHome 创建的备份。</p>
      </div>

      <fieldset
        className="settings-choice-group"
        disabled={busy || previewing || pendingRetention !== undefined}
      >
        <legend>每个配置保留</legend>
        <p>降低数量后会立即移除超出上限的最旧备份。</p>
        {RETENTION_OPTIONS.map(([value, label, description]) => (
          <label key={value} className="settings-choice">
            <input
              type="radio"
              name="backup-retention"
              value={value}
              checked={selectedRetention === value}
              disabled={pendingRetention !== undefined}
              onChange={() => void changeRetention(value)}
            />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <section
        className="rounded-lg border border-border bg-surface-muted p-3"
        aria-labelledby="backup-storage-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold" id="backup-storage-heading">
              本机备份存储
            </h4>
            {storage.status === "loading" ? (
              <p className="mt-1 text-xs text-muted-foreground" role="status">
                正在统计 UserHome 备份…
              </p>
            ) : storage.status === "error" ? (
              <p className="mt-1 text-xs text-danger" role="alert">
                {storage.error.message}
              </p>
            ) : (
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {summary?.displayLocation}
              </p>
            )}
          </div>
          {summary ? (
            <StatusBadge tone={summary.backupCount > 0 ? "neutral" : "success"}>
              {summary.backupCount} 份 · {formatBytes(summary.sizeBytes)}
            </StatusBadge>
          ) : null}
        </div>
        <div className="mt-3 flex justify-end border-t border-border pt-3">
          <Button
            variant="danger"
            disabled={
              !summary ||
              summary.backupCount === 0 ||
              busy ||
              previewing ||
              pendingRetention !== undefined
            }
            onClick={() => void openClearPreview()}
          >
            {previewing ? "正在准备预览…" : "清理所有备份…"}
          </Button>
        </div>
      </section>

      {error ? (
        <p className="settings-form__error" role="alert">
          {error.message}
        </p>
      ) : status ? (
        <p className="settings-form__status" role="status">
          {status}
        </p>
      ) : null}

      {preview ? (
        <BackupClearDialog
          busy={busy}
          error={dialogError}
          operation={operation}
          preview={preview}
          onCancel={() => {
            if (busy) return;
            setPreview(undefined);
            setOperation(undefined);
            setDialogError(undefined);
          }}
          onConfirm={() => void confirmClear()}
        />
      ) : null}
    </section>
  );
}
