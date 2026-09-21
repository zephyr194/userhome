import type {
  CloseBehavior,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
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
    <div className="settings-form" aria-busy={form.saving}>
      <div className="settings-control-list">
        <label className="settings-control-row">
          <span>
            <strong>启动时打开主窗口</strong>
            <small>关闭后，UserHome 仍可从托盘手动打开。</small>
          </span>
          <input
            type="checkbox"
            checked={form.values.openWindowOnLaunch}
            onChange={(event) =>
              void form.update("启动窗口偏好", {
                openWindowOnLaunch: event.currentTarget.checked,
              })
            }
          />
        </label>

        <label className="settings-control-row">
          <span>
            <strong>恢复上次选择</strong>
            <small>仅保存经过校验的路由、设置组和稳定条目 ID。</small>
          </span>
          <input
            type="checkbox"
            checked={form.values.restoreSelection}
            onChange={(event) =>
              void form.update("选择恢复偏好", {
                restoreSelection: event.currentTarget.checked,
              })
            }
          />
        </label>

        <label className="settings-control-row">
          <span>
            <strong>关闭主窗口时</strong>
            <small>选择保留托盘进程，或完全退出应用。</small>
          </span>
          <select
            value={form.values.closeBehavior}
            onChange={(event) =>
              void form.update("关闭行为", {
                closeBehavior: event.currentTarget.value as CloseBehavior,
              })
            }
          >
            <option value="KEEP_RUNNING_IN_TRAY">隐藏到托盘</option>
            <option value="QUIT_APPLICATION">退出应用</option>
          </select>
        </label>
      </div>

      {form.error ? (
        <p className="settings-form__error" role="alert">
          {form.error}
        </p>
      ) : form.status ? (
        <p className="settings-form__status" role="status">
          {form.status}
        </p>
      ) : null}
    </div>
  );
}
