import type {
  PreferredEditorMode,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { BackupSettings } from "./BackupSettings";
import { InfoTip, RadioCardGroup } from "../../components/ui";
import { useT } from "../../i18n/useLocale";
import { SettingsFeedback, SettingsForm } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

export function ConfigurationSettings({
  onChange,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const t = useT();
  const form = usePreferenceForm(preferences, onChange);

  return (
    <SettingsForm busy={form.saving}>
      <RadioCardGroup
        tip={<InfoTip description={t("settings.configuration.editorMode.tip")} title={t("settings.configuration.editorMode.label")} />}
        label={t("settings.configuration.editorMode.label")}
        name="preferred-editor-mode"
        value={form.values.preferredEditorMode}
        disabled={form.saving}
        options={[
          { value: "STRUCTURED", label: t("settings.configuration.editorMode.structured"), description: t("settings.configuration.editorMode.structuredDesc") },
          { value: "RAW", label: t("settings.configuration.editorMode.raw"), description: t("settings.configuration.editorMode.rawDesc") },
        ]}
        onValueChange={(preferredEditorMode) => void form.update(t("settings.saveLabel.editorMode"), { preferredEditorMode: preferredEditorMode as PreferredEditorMode })}
      />

      <BackupSettings
        onChange={onChange}
        preferences={preferences}
      />

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
