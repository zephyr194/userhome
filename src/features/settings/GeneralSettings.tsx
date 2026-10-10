import type {
  CloseBehavior,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import {
  SettingsFeedback,
  SettingsField,
  SettingsFieldList,
  SettingsForm,
} from "./SettingsPrimitives";
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
        <SettingsField
          label="启动时打开主窗口"
          description="关闭后，UserHome 仍可从托盘手动打开。"
        >
          <input
            className="size-4 shrink-0 accent-primary"
            type="checkbox"
            checked={form.values.openWindowOnLaunch}
            disabled={form.saving}
            onChange={(event) =>
              void form.update("启动窗口偏好", {
                openWindowOnLaunch: event.currentTarget.checked,
              })
            }
          />
        </SettingsField>

        <SettingsField
          label="恢复上次选择"
          description="仅保存经过校验的路由、设置组和稳定条目 ID。"
        >
          <input
            className="size-4 shrink-0 accent-primary"
            type="checkbox"
            checked={form.values.restoreSelection}
            disabled={form.saving}
            onChange={(event) =>
              void form.update("选择恢复偏好", {
                restoreSelection: event.currentTarget.checked,
              })
            }
          />
        </SettingsField>

        <SettingsField
          label="关闭主窗口时"
          description="选择保留托盘进程，或完全退出应用。"
        >
          <select
            className="min-h-control-sm max-w-full rounded-control border border-border bg-surface px-ui-lg py-ui-sm text-xs text-foreground"
            value={form.values.closeBehavior}
            disabled={form.saving}
            onChange={(event) =>
              void form.update("关闭行为", {
                closeBehavior: event.currentTarget.value as CloseBehavior,
              })
            }
          >
            <option value="KEEP_RUNNING_IN_TRAY">隐藏到托盘</option>
            <option value="QUIT_APPLICATION">退出应用</option>
          </select>
        </SettingsField>
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
