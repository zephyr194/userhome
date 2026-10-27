import { useEffect, useState } from "react";
import { Button, InfoTip, Panel, RadioCardGroup, StatusBadge } from "../../components/ui";
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
import { formatByteSize } from "../../i18n/format";
import type { MessageKey } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  SettingsActions,
  SettingsConfirmationDialog,
  SettingsFeedback,
  SettingsSection,
} from "./SettingsPrimitives";

type StorageState =
  | { status: "loading" }
  | { status: "ready"; summary: BackupStorageSummary }
  | { status: "error"; error: AppError };

const RETENTION_OPTIONS = [
  [5, "settings.backup.retention.desc5"],
  [10, "settings.backup.retention.desc10"],
  [20, "settings.backup.retention.desc20"],
] as const satisfies readonly [BackupRetention, MessageKey][];

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
  const t = useT();
  const finished = operation?.status === "SUCCEEDED";

  return (
    <SettingsConfirmationDialog
      action={
        !finished && !error ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t("settings.backup.clearing") : t("settings.backup.confirmClear")}
          </Button>
        ) : undefined
      }
      busy={busy}
      cancelLabel={finished || error ? t("common.close") : t("common.cancel")}
      error={error?.message}
      errorStatus={t("settings.backup.clearFailed")}
      eyebrow={t("settings.backup.clearEyebrow")}
      onCancel={onCancel}
      status={finished ? t("settings.backup.statusDone") : busy ? t("settings.backup.statusBusy") : t("settings.backup.statusWaiting")}
      statusTone={finished ? "success" : "warning"}
      title={preview.summary}
      titleId="backup-clear-heading"
    >
      <Panel
        className="bg-surface-muted p-ui-12"
        aria-labelledby="backup-clear-effects-heading"
      >
        <h4 className="text-xs font-semibold" id="backup-clear-effects-heading">
          {t("settings.backup.effectsHeading")}
        </h4>
        <ul className="mt-ui-8 mb-0 list-disc space-y-ui-4 pl-ui-16 text-muted-foreground">
          {preview.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </Panel>

      <p className="m-0 break-words text-xs leading-relaxed text-muted-foreground">
        {t("settings.backup.clearScopeNote")}
      </p>
    </SettingsConfirmationDialog>
  );
}

export function BackupSettings({
  onChange,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const t = useT();
  const locale = useLocale();
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
      setStatus(t("settings.backup.retentionSaved", { count: retention }));
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
      setStatus(t("settings.backup.cleared"));
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
      className="grid min-w-0 gap-ui-24"
      aria-busy={busy || previewing || pendingRetention !== undefined}
      aria-labelledby="backup-heading"
    >
      <SettingsSection
        title={t("settings.backup.title")}
        description={t("settings.backup.description")}
        headingId="backup-heading"
      />

      <RadioCardGroup
        tip={<InfoTip description={t("settings.backup.retention.tip")} title={t("settings.backup.retention.label")} />}
        label={t("settings.backup.retention.label")}
        name="backup-retention"
        value={String(selectedRetention)}
        disabled={busy || previewing || pendingRetention !== undefined}
        options={RETENTION_OPTIONS.map(([value, descriptionKey]) => ({
          value: String(value),
          label: t("settings.backup.retention.count", { count: value }),
          description: t(descriptionKey),
        }))}
        onValueChange={(value) => void changeRetention(Number(value) as BackupRetention)}
      />

      <Panel
        className="bg-surface-muted p-ui-12"
        aria-labelledby="backup-storage-heading"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold" id="backup-storage-heading">
              {t("settings.backup.storage.heading")}
            </h4>
            {storage.status === "loading" ? (
              <p className="mt-ui-4 mb-0 text-xs text-muted-foreground" role="status">
                {t("settings.backup.storage.loading")}
              </p>
            ) : storage.status === "error" ? (
              <p className="mt-ui-4 mb-0 text-xs text-danger" role="alert">
                {storage.error.message}
              </p>
            ) : (
              <p className="mt-ui-4 mb-0 break-all text-xs leading-relaxed text-muted-foreground">
                {summary?.displayLocation}
              </p>
            )}
          </div>
          {summary ? (
            <StatusBadge tone={summary.backupCount > 0 ? "neutral" : "success"}>
              {t("settings.backup.storage.summary", {
                count: summary.backupCount,
                size: formatByteSize(summary.sizeBytes, locale),
              })}
            </StatusBadge>
          ) : null}
        </div>
        <SettingsActions className="mt-ui-12">
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
            {previewing ? t("settings.backup.preparing") : t("settings.backup.clearAll")}
          </Button>
        </SettingsActions>
      </Panel>

      <SettingsFeedback error={error?.message} status={status} />

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
