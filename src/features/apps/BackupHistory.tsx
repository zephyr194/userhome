import { Button, Panel, StatusBadge } from "../../components/ui";
import type { BackupSummary } from "../../ipc/config";

export function BackupHistory({
  backups,
  disabled = false,
  onPreviewRestore,
}: {
  backups: readonly BackupSummary[];
  disabled?: boolean;
  onPreviewRestore: (backupId: string) => void;
}) {
  return (
    <Panel className="min-w-0 p-4" aria-labelledby="backup-history-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        受保护备份
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold" id="backup-history-heading">
          备份历史
        </h3>
        <StatusBadge>{backups.length} 项</StatusBadge>
      </div>
      {backups.length === 0 ? (
        <p className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground">
          暂无备份。
        </p>
      ) : (
        <div
          aria-label="备份历史，可滚动"
          className="mt-3 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border"
          tabIndex={0}
        >
          <ul className="divide-y divide-border">
            {backups.map((backup) => {
              const createdAt = new Date(backup.createdAtEpochMs);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 bg-surface px-3 py-2.5"
                  key={backup.backupId}
                >
                  <div className="min-w-0">
                    <time
                      className="block text-sm font-medium"
                      dateTime={createdAt.toISOString()}
                    >
                      {createdAt.toLocaleString("zh-CN")}
                    </time>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {backup.sizeBytes} bytes · 权限 {backup.mode.toString(8)}
                    </span>
                  </div>
                  <Button
                    disabled={disabled}
                    size="sm"
                    onClick={() => onPreviewRestore(backup.backupId)}
                  >
                    预览恢复
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
