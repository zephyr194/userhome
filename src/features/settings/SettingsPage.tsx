import { TabGroup, TabPanel, TabPanels } from "@headlessui/react";
import { AsyncState } from "../../components/AsyncState";
import { PageShell, StatusBadge } from "../../components/ui";
import type { PreferencesState } from "../../app/shellState";
import { useT } from "../../i18n/useLocale";
import type {
  Appearance,
  UpdatePreferencesRequest,
} from "../../ipc/settings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConfigurationSettings } from "./ConfigurationSettings";
import { DeepLinkSettings } from "./DeepLinkSettings";
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
  const t = useT();
  const selectedIndex = Math.max(
    0,
    SETTINGS_GROUPS.findIndex((candidate) => candidate.id === selectedGroup),
  );

  return (
    <TabGroup
      as="div"
      className="settings-pane borderless-pane h-full min-h-0 min-w-0"
      role="region"
      aria-label={t("settings.page.label")}
      selectedIndex={selectedIndex}
      onChange={(index) => onSelectedGroupChange(SETTINGS_GROUPS[index].id)}
      vertical
    >
      <PageShell layout="master-detail">
        <section className="settings-pane__groups flex min-h-0 min-w-0 flex-col overflow-hidden">
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
                    <header className="settings-pane__detail-header flex min-w-0 flex-none flex-wrap items-start justify-between gap-ui-12">
                      <div className="min-w-0">
                        <h2
                          className="m-0 break-words text-xl font-semibold"
                          id={headingId}
                        >
                          {t(group.labelKey)}
                        </h2>
                        <p className="mt-ui-4 mb-0 break-words text-xs leading-relaxed text-muted-foreground">
                          {t(group.summaryKey)}
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
                          ? t("common.loading")
                          : preferences.status === "safe-default"
                            ? t("settings.status.safeDefault")
                            : t("settings.status.loaded")}
                      </StatusBadge>
                    </header>

                    <div className="settings-pane__detail-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]">
                      {preferences.status === "safe-default" ? (
                        <p
                          className="m-0 mb-ui-12 rounded-control bg-warning-soft px-ui-12 py-ui-8 text-xs leading-relaxed text-warning"
                          role="status"
                        >
                          {t("settings.page.safeDefaultNotice", { message: preferences.diagnostic.message })}
                        </p>
                      ) : null}
                      {preferences.status === "loading" ? (
                        <AsyncState kind="loading">
                          {t("settings.page.loadingPreferences")}
                        </AsyncState>
                      ) : group.id === "appearance" ? (
                        <AppearanceSettings
                          onAppearanceChange={onAppearanceChange}
                          onPreferencesChange={onPreferencesChange}
                          preferences={preferences.preferences}
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
                      ) : group.id === "deepLink" ? (
                        <DeepLinkSettings />
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
