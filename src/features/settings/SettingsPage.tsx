import { TabGroup, TabPanel, TabPanels } from "@headlessui/react";
import { AsyncState } from "../../components/AsyncState";
import { PageShell, StatusBadge } from "../../components/ui";
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
      as="div"
      className="settings-pane h-full min-h-0 min-w-0"
      role="region"
      aria-label="设置"
      selectedIndex={selectedIndex}
      onChange={(index) => onSelectedGroupChange(SETTINGS_GROUPS[index].id)}
      vertical
    >
      <PageShell layout="master-detail">
        <section
          className="settings-pane__groups flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-muted"
          aria-labelledby="settings-groups-heading"
        >
          <header className="min-w-0 border-b border-border px-ui-12 py-ui-12">
            <span
              className="block break-words text-xs font-semibold tracking-widest text-muted-foreground uppercase"
              id="settings-groups-heading"
            >
              分组
            </span>
          </header>
          <SettingsSidebar selectedGroup={SETTINGS_GROUPS[selectedIndex].id} />
        </section>

        <TabPanels className="min-h-0 min-w-0 overflow-hidden">
          {SETTINGS_GROUPS.map((group, index) => {
            const headingId = `settings-${group.id}-heading`;
            return (
              <TabPanel
                key={group.id}
                className="settings-pane__detail flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
                id={`settings-panel-${group.id}`}
                aria-labelledby={headingId}
              >
                {index === selectedIndex ? (
                  <>
                    <header className="settings-pane__detail-header flex min-w-0 flex-none flex-wrap items-start justify-between gap-ui-12 border-b border-border">
                      <div className="min-w-0">
                        <h2
                          className="m-0 break-words text-xl font-semibold"
                          id={headingId}
                        >
                          {group.label}
                        </h2>
                        <p className="mt-ui-4 mb-0 break-words text-xs leading-relaxed text-muted-foreground">
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

                    <div className="settings-pane__detail-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]">
                      {preferences.status === "safe-default" ? (
                        <p
                          className="m-0 mb-ui-12 rounded-control bg-warning-soft px-ui-12 py-ui-8 text-xs leading-relaxed text-warning"
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
      </PageShell>
    </TabGroup>
  );
}
