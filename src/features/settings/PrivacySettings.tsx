import { useId, useState } from "react";
import type {
  OptionalDiscoveryRoot,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { CheckboxField, InfoTip } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import { formatNumber } from "../../i18n/format";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsSection, SettingsValueField } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

const ROOTS: readonly {
  id: OptionalDiscoveryRoot;
  label: string;
  descriptionKey: MessageKey;
}[] = [
  {
    id: "HOME",
    label: "~/",
    descriptionKey: "settings.privacy.root.home",
  },
  {
    id: "XDG_CONFIG_HOME",
    label: "XDG_CONFIG_HOME/",
    descriptionKey: "settings.privacy.root.xdgConfigHome",
  },
  {
    id: "APPLICATION_SUPPORT",
    label: "APPLICATION_SUPPORT/",
    descriptionKey: "settings.privacy.root.applicationSupport",
  },
  {
    id: "HOMEBREW_PREFIX",
    label: "HOMEBREW_PREFIX/etc/",
    descriptionKey: "settings.privacy.root.homebrewPrefix",
  },
];

export function PrivacySettings({
  onChange,
  onDiscoveryRefresh,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  onDiscoveryRefresh: () => void | Promise<void>;
  preferences: UserPreferences;
}) {
  const t = useT();
  const locale = useLocale();
  const form = usePreferenceForm(preferences, onChange);
  const [refreshing, setRefreshing] = useState(false);
  const rootsHeadingId = useId();

  async function toggleRoot(
    root: OptionalDiscoveryRoot,
    enabled: boolean,
  ): Promise<void> {
    const enabledRoots = new Set(form.values.optionalDiscoveryRoots);
    if (enabled) {
      enabledRoots.add(root);
    } else {
      enabledRoots.delete(root);
    }
    const optionalDiscoveryRoots = ROOTS.map(({ id }) => id).filter((id) =>
      enabledRoots.has(id),
    );
    setRefreshing(true);
    try {
      if (
        await form.update(t("settings.saveLabel.discoveryRoots"), {
          optionalDiscoveryRoots,
        })
      ) {
        await onDiscoveryRefresh();
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SettingsForm busy={form.saving || refreshing}>
      <SettingsSection
        description={t("settings.privacy.roots.description")}
        headingId={rootsHeadingId}
        title={t("settings.privacy.roots.title")}
      >
        <SettingsFieldList>
          {ROOTS.map((root) => (
            <CheckboxField
              key={root.id}
              className="py-ui-12"
              tip={<InfoTip description={t(root.descriptionKey)} title={root.label} />}
              label={root.label}
              checked={form.values.optionalDiscoveryRoots.includes(root.id)}
              disabled={form.saving || refreshing}
              onCheckedChange={(checked) => void toggleRoot(root.id, checked)}
            />
          ))}
        </SettingsFieldList>
      </SettingsSection>

      <SettingsFieldList>
        <SettingsValueField
          label={t("settings.privacy.activeRoots.label")}
          description={t("settings.privacy.activeRoots.description")}
          role="status"
        >
          {formatNumber(form.values.optionalDiscoveryRoots.length, locale)} / {formatNumber(ROOTS.length, locale)}
        </SettingsValueField>
        <SettingsValueField
          label={t("settings.privacy.catalogBoundary.label")}
          description={t("settings.privacy.catalogBoundary.description")}
        >
          {t("settings.privacy.catalogBoundary.value")}
        </SettingsValueField>
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
