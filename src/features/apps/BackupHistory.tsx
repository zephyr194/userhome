import type { BackupSummary } from "../../ipc/config";

export function BackupHistory({
  backups,
  onPreviewRestore,
}: {
  backups: readonly BackupSummary[];
  onPreviewRestore: (backupId: string) => void;
}) {
  return (
    <section className="backup-history" aria-labelledby="backup-history-heading">
      <p className="section-kicker">受保护备份</p>
      <h3 id="backup-history-heading">备份历史</h3>
      {backups.length === 0 ? (
        <p>暂无备份。</p>
      ) : (
        <ul className="history-list">
          {backups.map((backup) => (
            <li key={backup.backupId}>
              <div>
                <strong>{new Date(backup.createdAtEpochMs).toLocaleString("zh-CN")}</strong>
                <span>{backup.sizeBytes} bytes · 权限 {backup.mode.toString(8)}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onPreviewRestore(backup.backupId)}
              >
                预览恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
