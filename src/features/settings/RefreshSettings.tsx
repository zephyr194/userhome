import type {
  ProviderTimeoutPreset,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { InfoTip, SelectField, SwitchField } from "../../components/ui";
import { useT } from "../../i18n/useLocale";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsValueField } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

export function RefreshSettings({
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
      <SettingsFieldList>
        <SwitchField className="py-ui-12" tip={<InfoTip description={t("settings.refresh.onLaunch.tip")} title={t("settings.refresh.onLaunch.label")} />} label={t("settings.refresh.onLaunch.label")} checked={form.values.refreshOnLaunch} disabled={form.saving} onCheckedChange={(checked) => void form.update(t("settings.saveLabel.launchRefresh"), { refreshOnLaunch: checked })} />
        <SwitchField className="py-ui-12" tip={<InfoTip description={t("settings.refresh.onReopen.tip")} title={t("settings.refresh.onReopen.label")} />} label={t("settings.refresh.onReopen.label")} checked={form.values.refreshOnReopen} disabled={form.saving} onCheckedChange={(checked) => void form.update(t("settings.saveLabel.reopenRefresh"), { refreshOnReopen: checked })} />
        <SelectField className="py-ui-12" tip={<InfoTip description={t("settings.refresh.timeout.tip")} title={t("settings.refresh.timeout.label")} />} label={t("settings.refresh.timeout.label")} value={form.values.providerTimeoutPreset} disabled={form.saving} options={[{ value: "SHORT", label: t("settings.refresh.timeout.short") }, { value: "STANDARD", label: t("settings.refresh.timeout.standard") }, { value: "EXTENDED", label: t("settings.refresh.timeout.extended") }]} onValueChange={(providerTimeoutPreset) => void form.update(t("settings.saveLabel.timeout"), { providerTimeoutPreset: providerTimeoutPreset as ProviderTimeoutPreset })} />
        <SettingsValueField label={t("settings.refresh.periodic.label")} description={t("settings.refresh.periodic.description")} role="status">{t("settings.refresh.periodic.value")}</SettingsValueField>
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
