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
  onDiscoveryRefresh: () => void | Promise<void>;
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
    <section
      className="settings-pane grid h-full min-h-0 grid-rows-[minmax(8rem,11rem)_minmax(0,1fr)] overflow-hidden rounded-panel border border-border bg-surface md:grid-cols-[14.5rem_minmax(0,1fr)] md:grid-rows-1"
      aria-label="设置"
    >
      <section
        className="settings-pane__groups grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-b border-border bg-surface-muted md:border-r md:border-b-0"
        aria-labelledby="settings-groups-heading"
      >
        <header className="settings-pane__groups-header border-b border-border px-ui-2xl py-ui-xl">
          <h2 className="m-0 text-base font-semibold" id="settings-groups-heading">
            设置
          </h2>
          <p className="mt-ui-xs mb-0 text-xs text-muted-foreground">
            本机偏好与应用行为
          </p>
        </header>
        <SettingsSidebar
          onSelect={onSelectedGroupChange}
          selectedGroup={selectedGroup}
        />
      </section>

      <section
        className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-surface"
        id={`settings-panel-${group.id}`}
        aria-labelledby={headingId}
        tabIndex={0}
      >
        <header className="settings-pane__detail-header flex min-w-0 flex-wrap items-start justify-between gap-ui-xl border-b border-border px-ui-3xl py-ui-2xl">
          <div className="min-w-0">
            <p className="section-kicker m-0">UserHome 偏好</p>
            <h2
              className="mt-ui-xs mb-0 break-words text-xl font-semibold"
              id={headingId}
            >
              {group.label}
            </h2>
            <p className="mt-ui-xs mb-0 break-words text-xs leading-relaxed text-muted-foreground">
              {group.summary}
            </p>
          </div>
          <StatusBadge
            className="shrink-0"
            tone={
              preferences.status === "safe-default" ? "warning" : "neutral"
            }
          >
            {preferences.status === "loading"
              ? "加载中"
              : preferences.status === "safe-default"
                ? "安全默认值"
                : "已加载"}
          </StatusBadge>
        </header>

        <div className="settings-pane__detail-content min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-ui-3xl py-ui-2xl [overscroll-behavior:contain] [scrollbar-gutter:stable]">
          {preferences.status === "safe-default" ? (
            <p
              className="m-0 mb-ui-xl rounded-control border border-warning-border bg-warning-soft px-ui-xl py-ui-lg text-xs leading-relaxed text-warning"
              role="status"
            >
              正在使用安全默认值：{preferences.diagnostic.message}
            </p>
          ) : null}
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
