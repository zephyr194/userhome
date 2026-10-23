import type { MessageKey } from "../../i18n";

export type SettingsGroupId =
  | "appearance"
  | "general"
  | "refresh"
  | "configuration"
  | "privacy"
  | "diagnostics"
  | "reset";

export interface SettingsGroup {
  id: SettingsGroupId;
  labelKey: MessageKey;
  summaryKey: MessageKey;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "appearance",
    labelKey: "settings.group.appearance.label",
    summaryKey: "settings.group.appearance.summary",
  },
  {
    id: "general",
    labelKey: "settings.group.general.label",
    summaryKey: "settings.group.general.summary",
  },
  {
    id: "refresh",
    labelKey: "settings.group.refresh.label",
    summaryKey: "settings.group.refresh.summary",
  },
  {
    id: "configuration",
    labelKey: "settings.group.configuration.label",
    summaryKey: "settings.group.configuration.summary",
  },
  {
    id: "privacy",
    labelKey: "settings.group.privacy.label",
    summaryKey: "settings.group.privacy.summary",
  },
  {
    id: "diagnostics",
    labelKey: "settings.group.diagnostics.label",
    summaryKey: "settings.group.diagnostics.summary",
  },
  {
    id: "reset",
    labelKey: "settings.group.reset.label",
    summaryKey: "settings.group.reset.summary",
  },
];
