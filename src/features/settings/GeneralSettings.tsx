import type {
  CloseBehavior,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { InfoTip, SelectField, SwitchField } from "../../components/ui";
import { SettingsFeedback, SettingsFieldList, SettingsForm } from "./SettingsPrimitives";
import { DeepLinkSettings } from "./DeepLinkSettings";
import { usePreferenceForm } from "./usePreferenceForm";

export function GeneralSettings({
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
        <SwitchField className="py-ui-12" tip={<InfoTip description="关闭后，启动时只在托盘运行，可随时从托盘打开主窗口。" title="启动时打开主窗口" />} label="启动时打开主窗口" checked={form.values.openWindowOnLaunch} disabled={form.saving} onCheckedChange={(checked) => void form.update("启动窗口偏好", { openWindowOnLaunch: checked })} />
        <SwitchField className="py-ui-12" tip={<InfoTip description="仅保存经过校验的路由、设置组和稳定条目 ID。" title="恢复上次选择" />} label="恢复上次选择" checked={form.values.restoreSelection} disabled={form.saving} onCheckedChange={(checked) => void form.update("选择恢复偏好", { restoreSelection: checked })} />
        <SelectField className="py-ui-12" tip={<InfoTip description="选择保留托盘进程，或完全退出应用。" title="关闭主窗口时" />} label="关闭主窗口时" value={form.values.closeBehavior} disabled={form.saving} options={[{ value: "KEEP_RUNNING_IN_TRAY", label: "隐藏到托盘" }, { value: "QUIT_APPLICATION", label: "退出应用" }]} onValueChange={(closeBehavior) => void form.update("关闭行为", { closeBehavior: closeBehavior as CloseBehavior })} />
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
      <DeepLinkSettings />
    </SettingsForm>
  );
}
