import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type { PreferencesState } from "../../app/shellState";
import { SettingsSidebar } from "./SettingsSidebar";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";
import { getSettingsSummaries } from "./settingsSummaries";

export function SettingsPage({
  onSelectedGroupChange,
  preferences,
  selectedGroup,
}: {
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
          ) : (
            <dl className="settings-summary-list">
              {getSettingsSummaries(
                group.id,
                preferences.preferences,
                preferences,
              ).map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>
                    <strong>{item.value}</strong>
                    <span>{item.description}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>
    </section>
  );
}
