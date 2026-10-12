import { TabGroup, TabPanel, TabPanels } from "@headlessui/react";
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
  const selectedIndex = Math.max(
    0,
    SETTINGS_GROUPS.findIndex((candidate) => candidate.id === selectedGroup),
  );

  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={(index) => onSelectedGroupChange(SETTINGS_GROUPS[index].id)}
      vertical
    >
      <section
        className="settings-pane grid h-full min-h-0 min-w-0 grid-rows-[minmax(8rem,11rem)_minmax(0,1fr)] overflow-hidden md:grid-cols-[14.5rem_minmax(0,1fr)] md:grid-rows-1"
        aria-label="设置"
      >
        <section
          className="settings-pane__groups grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-b border-border bg-surface-muted md:border-r md:border-b-0"
          aria-labelledby="settings-groups-heading"
        >
          <header className="settings-pane__groups-header min-w-0 border-b border-border px-ui-2xl py-ui-xl">
            <span
              className="block break-words text-xs font-semibold tracking-widest text-muted-foreground uppercase"
              id="settings-groups-heading"
            >
              分组
            </span>
          </header>
          <SettingsSidebar />
        </section>

        <TabPanels className="min-h-0 min-w-0 overflow-hidden">
          {SETTINGS_GROUPS.map((group, index) => {
            const headingId = `settings-${group.id}-heading`;
            return (
              <TabPanel
                key={group.id}
                className="settings-pane__detail grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-surface"
                id={`settings-panel-${group.id}`}
                aria-labelledby={headingId}
              >
                {index === selectedIndex ? (
                  <>
                    <header className="settings-pane__detail-header flex min-w-0 flex-wrap items-start justify-between gap-ui-xl border-b border-border px-ui-3xl py-ui-2xl">
                      <div className="min-w-0">
                        <h2
                          className="m-0 break-words text-xl font-semibold"
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
                          preferences.status === "safe-default"
                            ? "warning"
                            : "neutral"
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
                          className="m-0 mb-ui-xl rounded-control bg-warning-soft px-ui-xl py-ui-lg text-xs leading-relaxed text-warning"
                          role="status"
                        >
                          正在使用安全默认值：{preferences.diagnostic.message}
                        </p>
                      ) : null}
                      {preferences.status === "loading" ? (
                        <AsyncState kind="loading">
                          正在加载本机偏好设置…
                        </AsyncState>
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
                  </>
                ) : null}
              </TabPanel>
            );
          })}
        </TabPanels>
      </section>
    </TabGroup>
  );
}
