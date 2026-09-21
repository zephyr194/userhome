import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type { PreferencesState } from "../../app/shellState";
import type {
  Appearance,
  UpdatePreferencesRequest,
} from "../../ipc/settings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConfigurationSettings } from "./ConfigurationSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { GeneralSettings } from "./GeneralSettings";
import { PrivacySettings } from "./PrivacySettings";
import { RefreshSettings } from "./RefreshSettings";
import { ResetSettings } from "./ResetSettings";
import { SettingsSidebar } from "./SettingsSidebar";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";

export function SettingsPage({
  onAppearanceChange,
  onDiscoveryRefresh,
  onPreferencesChange,
  onPreferencesReset,
  onSelectedGroupChange,
  preferences,
  selectedGroup,
}: {
  onAppearanceChange: (appearance: Appearance) => Promise<void>;
  onDiscoveryRefresh: () => void;
  onPreferencesChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  onPreferencesReset: () => Promise<void>;
  onSelectedGroupChange: (group: SettingsGroupId) => void;
  preferences: PreferencesState;
  selectedGroup: SettingsGroupId;
}) {
  const group =
    SETTINGS_GROUPS.find((candidate) => candidate.id === selectedGroup) ??
    SETTINGS_GROUPS[0];
  const headingId = `settings-${group.id}-heading`;

  return (
    <section className="settings-workspace" aria-label="设置">
      <section
        className="settings-workspace__sidebar"
        aria-labelledby="settings-groups-heading"
      >
        <header className="settings-workspace__sidebar-header">
          <h2 id="settings-groups-heading">设置</h2>
          <p>本机偏好与应用行为</p>
        </header>
        <SettingsSidebar
          onSelect={onSelectedGroupChange}
          selectedGroup={selectedGroup}
        />
      </section>

      <section
        className="settings-workspace__detail"
        id={`settings-panel-${group.id}`}
        aria-labelledby={headingId}
        tabIndex={0}
      >
        <header className="settings-workspace__detail-header">
          <div className="min-w-0">
            <p className="section-kicker">UserHome 偏好</p>
            <h2 id={headingId}>{group.label}</h2>
            <p>{group.summary}</p>
          </div>
          <StatusBadge>
            {preferences.status === "loading"
              ? "加载中"
              : preferences.status === "safe-default"
                ? "安全默认值"
                : "已加载"}
          </StatusBadge>
        </header>

        <div className="settings-workspace__detail-content">
          {preferences.status === "loading" ? (
            <AsyncState kind="loading">正在加载本机偏好设置…</AsyncState>
          ) : group.id === "appearance" ? (
            <AppearanceSettings
              appearance={preferences.preferences.appearance}
              onChange={onAppearanceChange}
            />
          ) : group.id === "general" ? (
            <GeneralSettings
              onChange={onPreferencesChange}
              preferences={preferences.preferences}
            />
          ) : group.id === "refresh" ? (
            <RefreshSettings
              onChange={onPreferencesChange}
              preferences={preferences.preferences}
            />
          ) : group.id === "configuration" ? (
            <ConfigurationSettings
              onChange={onPreferencesChange}
              preferences={preferences.preferences}
            />
          ) : group.id === "privacy" ? (
            <PrivacySettings
              onChange={onPreferencesChange}
              onDiscoveryRefresh={onDiscoveryRefresh}
              preferences={preferences.preferences}
            />
          ) : group.id === "diagnostics" ? (
            <DiagnosticsSettings />
          ) : (
            <ResetSettings
              onDiscoveryRefresh={onDiscoveryRefresh}
              onReset={onPreferencesReset}
            />
          )}
        </div>
      </section>
    </section>
  );
}
