import { useState } from "react";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import { useT } from "../../i18n/useLocale";
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
  const t = useT();
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
            {busy ? t("settings.reset.confirming") : t("settings.reset.confirm")}
          </Button>
        ) : undefined
      }
      busy={busy}
      cancelLabel={error ? t("common.close") : t("common.cancel")}
      error={error?.message}
      errorStatus={t("settings.reset.failed")}
      eyebrow={t("settings.reset.eyebrow")}
      onCancel={onCancel}
      status={busy ? t("settings.reset.statusBusy") : t("settings.reset.statusWaiting")}
      title={t("settings.reset.title")}
      titleId="preferences-reset-heading"
    >
      <Panel
        className="bg-surface-muted p-ui-12"
        aria-labelledby="preferences-reset-effects-heading"
      >
        <h4
          className="text-xs font-semibold"
          id="preferences-reset-effects-heading"
        >
          {t("settings.reset.effects.heading")}
        </h4>
        <ul className="mt-ui-8 mb-0 list-disc space-y-ui-4 pl-ui-16 text-muted-foreground">
          <li>{t("settings.reset.effects.preferences")}</li>
          <li>{t("settings.reset.effects.backups")}</li>
          <li>{t("settings.reset.effects.managed")}</li>
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
  const t = useT();
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
      setStatus(t("settings.reset.done"));
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
          label={t("settings.reset.prefs.label")}
          description={t("settings.reset.prefs.description")}
        >
          {t("settings.reset.prefs.value")}
        </SettingsValueField>
        <SettingsValueField
          label={t("settings.reset.backups.label")}
          description={t("settings.reset.backups.description")}
        >
          <StatusBadge tone="success">{t("settings.reset.kept")}</StatusBadge>
        </SettingsValueField>
        <SettingsValueField
          label={t("settings.reset.managed.label")}
          description={t("settings.reset.managed.description")}
        >
          <StatusBadge tone="success">{t("settings.reset.kept")}</StatusBadge>
        </SettingsValueField>
      </SettingsFieldList>

      <SettingsDangerZone
        title={t("settings.reset.dangerTitle")}
        description={t("settings.reset.dangerDescription")}
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
          {t("settings.reset.open")}
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
