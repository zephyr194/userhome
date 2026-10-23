import type { PreferencesState } from "../../app/shellState";
import type { TranslateFunction } from "../../i18n";
import type { UserPreferences } from "../../ipc/settings";
import type { SettingsGroupId } from "./settingsGroups";

export interface SettingSummary {
  label: string;
  value: string;
  description: string;
}

function appearanceLabel(
  t: TranslateFunction,
  appearance: UserPreferences["appearance"],
): string {
  switch (appearance) {
    case "SYSTEM":
      return t("settings.summary.appearance.system");
    case "LIGHT":
      return t("settings.summary.appearance.light");
    case "DARK":
      return t("settings.summary.appearance.dark");
  }
}

function timeoutLabel(
  t: TranslateFunction,
  preset: UserPreferences["providerTimeoutPreset"],
): string {
  switch (preset) {
    case "SHORT":
      return t("settings.summary.timeout.short");
    case "STANDARD":
      return t("settings.summary.timeout.standard");
    case "EXTENDED":
      return t("settings.summary.timeout.extended");
  }
}

function editorLabel(
  t: TranslateFunction,
  mode: UserPreferences["preferredEditorMode"],
): string {
  return mode === "STRUCTURED"
    ? t("settings.summary.editor.structured")
    : t("settings.summary.editor.raw");
}

function rootLabel(
  t: TranslateFunction,
  root: UserPreferences["optionalDiscoveryRoots"][number],
): string {
  switch (root) {
    case "HOME":
      return "~";
    case "XDG_CONFIG_HOME":
      return t("settings.summary.root.xdgConfigHome");
    case "APPLICATION_SUPPORT":
      return "Application Support";
    case "HOMEBREW_PREFIX":
      return t("settings.summary.root.homebrewPrefix");
  }
}

function enabledLabel(t: TranslateFunction, enabled: boolean): string {
  return enabled
    ? t("settings.summary.enabled")
    : t("settings.summary.disabled");
}

export function getSettingsSummaries(
  t: TranslateFunction,
  group: SettingsGroupId,
  preferences: UserPreferences,
  state: PreferencesState,
): readonly SettingSummary[] {
  switch (group) {
    case "appearance":
      return [
        {
          label: t("settings.summary.appearance.label"),
          value: appearanceLabel(t, preferences.appearance),
          description: t("settings.summary.appearance.description"),
        },
        {
          label: t("settings.appearance.density.label"),
          value: t("settings.appearance.density.value"),
          description: t("settings.appearance.density.description"),
        },
        {
          label: t("settings.appearance.motion.label"),
          value: t("settings.appearance.motion.value"),
          description: t("settings.appearance.motion.description"),
        },
      ];
    case "general":
      return [
        {
          label: t("settings.general.openWindow.label"),
          value: enabledLabel(t, preferences.openWindowOnLaunch),
          description: t("settings.summary.general.openWindow.description"),
        },
        {
          label: t("settings.summary.general.closeWindow.label"),
          value:
            preferences.closeBehavior === "KEEP_RUNNING_IN_TRAY"
              ? t("settings.summary.general.keepInTray")
              : t("settings.general.closeBehavior.quit"),
          description: t("settings.summary.general.closeWindow.description"),
        },
        {
          label: t("settings.general.restoreSelection.label"),
          value: enabledLabel(t, preferences.restoreSelection),
          description: t("settings.summary.general.restoreSelection.description"),
        },
      ];
    case "refresh":
      return [
        {
          label: t("settings.refresh.onLaunch.label"),
          value: enabledLabel(t, preferences.refreshOnLaunch),
          description: t("settings.summary.refresh.onLaunch.description"),
        },
        {
          label: t("settings.refresh.onReopen.label"),
          value: enabledLabel(t, preferences.refreshOnReopen),
          description: t("settings.summary.refresh.onReopen.description"),
        },
        {
          label: t("settings.summary.refresh.timeout.label"),
          value: timeoutLabel(t, preferences.providerTimeoutPreset),
          description: t("settings.summary.refresh.timeout.description"),
        },
        {
          label: t("settings.summary.refresh.background.label"),
          value: t("settings.refresh.periodic.value"),
          description: t("settings.summary.refresh.background.description"),
        },
      ];
    case "configuration":
      return [
        {
          label: t("settings.summary.configuration.editor.label"),
          value: editorLabel(t, preferences.preferredEditorMode),
          description: t("settings.summary.configuration.editor.description"),
        },
        {
          label: t("settings.summary.configuration.backup.label"),
          value: t("settings.summary.configuration.backupCount", {
            count: preferences.backupRetention,
          }),
          description: t("settings.summary.configuration.backup.description"),
        },
        {
          label: t("settings.summary.configuration.boundary.label"),
          value: t("settings.summary.configuration.boundary.value"),
          description: t("settings.summary.configuration.boundary.description"),
        },
      ];
    case "deepLink":
      return [];
    case "privacy":
      return [
        {
          label: t("settings.summary.privacy.roots.label"),
          value:
            preferences.optionalDiscoveryRoots
              .map((root) => rootLabel(t, root))
              .join(t("settings.summary.privacy.rootsSeparator")) ||
            t("settings.summary.privacy.allOff"),
          description: t("settings.summary.privacy.roots.description"),
        },
        {
          label: t("settings.summary.privacy.content.label"),
          value: t("settings.summary.privacy.content.value"),
          description: t("settings.summary.privacy.content.description"),
        },
        {
          label: t("settings.summary.privacy.network.label"),
          value: t("settings.summary.privacy.network.value"),
          description: t("settings.summary.privacy.network.description"),
        },
      ];
    case "diagnostics":
      return [
        {
          label: t("settings.summary.diagnostics.state.label"),
          value:
            state.status === "safe-default"
              ? t("settings.status.safeDefault")
              : t("settings.summary.diagnostics.verified"),
          description:
            state.status === "safe-default"
              ? state.diagnostic.message
              : t("settings.summary.diagnostics.loaded"),
        },
        {
          label: t("settings.summary.diagnostics.schema.label"),
          value: t("settings.summary.diagnostics.schema.value", {
            version: preferences.schemaVersion,
          }),
          description: t("settings.summary.diagnostics.schema.description"),
        },
        {
          label: t("settings.summary.diagnostics.boundary.label"),
          value: t("settings.summary.diagnostics.boundary.value"),
          description: t("settings.summary.diagnostics.boundary.description"),
        },
      ];
    case "reset":
      return [
        {
          label: t("settings.summary.reset.scope.label"),
          value: t("settings.summary.reset.scope.value"),
          description: t("settings.summary.reset.scope.description"),
        },
        {
          label: t("settings.summary.reset.appConfig.label"),
          value: t("settings.reset.kept"),
          description: t("settings.summary.reset.appConfig.description"),
        },
        {
          label: t("settings.reset.backups.label"),
          value: t("settings.reset.kept"),
          description: t("settings.summary.reset.backups.description"),
        },
      ];
  }
}
