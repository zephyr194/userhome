import type {
  CloseBehavior,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { InfoTip, SelectField, SwitchField } from "../../components/ui";
import { useT } from "../../i18n/useLocale";
import { SettingsFeedback, SettingsFieldList, SettingsForm } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

export function GeneralSettings({
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
        <SwitchField className="py-ui-12" tip={<InfoTip description={t("settings.general.openWindow.tip")} title={t("settings.general.openWindow.label")} />} label={t("settings.general.openWindow.label")} checked={form.values.openWindowOnLaunch} disabled={form.saving} onCheckedChange={(checked) => void form.update(t("settings.saveLabel.launchWindow"), { openWindowOnLaunch: checked })} />
        <SwitchField className="py-ui-12" tip={<InfoTip description={t("settings.general.restoreSelection.tip")} title={t("settings.general.restoreSelection.label")} />} label={t("settings.general.restoreSelection.label")} checked={form.values.restoreSelection} disabled={form.saving} onCheckedChange={(checked) => void form.update(t("settings.saveLabel.selectionRestore"), { restoreSelection: checked })} />
        <SelectField className="py-ui-12" tip={<InfoTip description={t("settings.general.closeBehavior.tip")} title={t("settings.general.closeBehavior.label")} />} label={t("settings.general.closeBehavior.label")} value={form.values.closeBehavior} disabled={form.saving} options={[{ value: "KEEP_RUNNING_IN_TRAY", label: t("settings.general.closeBehavior.hideToTray") }, { value: "QUIT_APPLICATION", label: t("settings.general.closeBehavior.quit") }]} onValueChange={(closeBehavior) => void form.update(t("settings.saveLabel.closeBehavior"), { closeBehavior: closeBehavior as CloseBehavior })} />
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
