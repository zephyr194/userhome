import type {
  ProviderTimeoutPreset,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
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
    <div className="settings-form" aria-busy={form.saving}>
      <div className="settings-control-list">
        <label className="settings-control-row">
          <span>
            <strong>启动时刷新</strong>
            <small>打开应用时运行一次有界 provider 扫描。</small>
          </span>
          <input
            type="checkbox"
            checked={form.values.refreshOnLaunch}
            onChange={(event) =>
              void form.update("启动刷新偏好", {
                refreshOnLaunch: event.currentTarget.checked,
              })
            }
          />
        </label>

        <label className="settings-control-row">
          <span>
            <strong>从托盘重开时刷新</strong>
            <small>仅在隐藏窗口重新显示时运行，不会周期性扫描。</small>
          </span>
          <input
            type="checkbox"
            checked={form.values.refreshOnReopen}
            onChange={(event) =>
              void form.update("重开刷新偏好", {
                refreshOnReopen: event.currentTarget.checked,
              })
            }
          />
        </label>

        <label className="settings-control-row">
          <span>
            <strong>Provider 超时</strong>
            <small>仅可使用受限预设；较长预设不会启用后台扫描。</small>
          </span>
          <select
            value={form.values.providerTimeoutPreset}
            onChange={(event) =>
              void form.update("Provider 超时", {
                providerTimeoutPreset: event.currentTarget
                  .value as ProviderTimeoutPreset,
              })
            }
          >
            <option value="SHORT">短（本机 1 秒 / Homebrew 5 秒）</option>
            <option value="STANDARD">标准（本机 2 秒 / Homebrew 10 秒）</option>
            <option value="EXTENDED">延长（本机 5 秒 / Homebrew 20 秒）</option>
          </select>
        </label>

        <div className="settings-control-row" role="status">
          <span>
            <strong>周期性后台扫描</strong>
            <small>UserHome 只在启动、重开或手动请求时刷新。</small>
          </span>
          <span className="settings-control-row__value">关闭</span>
        </div>
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
