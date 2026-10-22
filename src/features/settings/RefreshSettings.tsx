import type {
  ProviderTimeoutPreset,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { InfoTip, SelectField, SwitchField } from "../../components/ui";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsValueField } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

export function RefreshSettings({
  onChange,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const form = usePreferenceForm(preferences, onChange);

  return (
    <SettingsForm busy={form.saving}>
      <SettingsFieldList>
        <SwitchField className="py-ui-12" tip={<InfoTip description="打开应用时运行一次有界的本机检测。" title="启动时刷新" />} label="启动时刷新" checked={form.values.refreshOnLaunch} disabled={form.saving} onCheckedChange={(checked) => void form.update("启动刷新偏好", { refreshOnLaunch: checked })} />
        <SwitchField className="py-ui-12" tip={<InfoTip description="仅在隐藏窗口重新显示时运行，不会周期性扫描。" title="从托盘重开时刷新" />} label="从托盘重开时刷新" checked={form.values.refreshOnReopen} disabled={form.saving} onCheckedChange={(checked) => void form.update("重开刷新偏好", { refreshOnReopen: checked })} />
        <SelectField className="py-ui-12" tip={<InfoTip description="仅可使用受限预设；较长预设不会启用后台扫描。" title="检测超时" />} label="检测超时" value={form.values.providerTimeoutPreset} disabled={form.saving} options={[{ value: "SHORT", label: "短（本机 1 秒 / Homebrew 5 秒）" }, { value: "STANDARD", label: "标准（本机 2 秒 / Homebrew 10 秒）" }, { value: "EXTENDED", label: "延长（本机 5 秒 / Homebrew 20 秒）" }]} onValueChange={(providerTimeoutPreset) => void form.update("检测超时", { providerTimeoutPreset: providerTimeoutPreset as ProviderTimeoutPreset })} />
        <SettingsValueField label="周期性后台扫描" description="UserHome 只在启动、重开或手动请求时刷新。" role="status">关闭</SettingsValueField>
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
