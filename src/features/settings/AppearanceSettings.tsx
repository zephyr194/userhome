import { useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import type {
  Appearance,
  LanguagePreference,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { InfoTip, RadioCardGroup } from "../../components/ui";
import { LANGUAGE_NAMES } from "../../i18n/messages/languageNames";
import { useT } from "../../i18n/useLocale";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsValueField } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

interface AppearanceOption {
  description: string;
  label: string;
  value: Appearance;
}

interface LanguageOption {
  description: string;
  label: string;
  value: LanguagePreference;
}

export function AppearanceSettings({
  onAppearanceChange,
  onPreferencesChange,
  preferences,
}: {
  onAppearanceChange: (appearance: Appearance) => Promise<void>;
  onPreferencesChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const t = useT();
  const appearance = preferences.appearance;
  const [pendingAppearance, setPendingAppearance] = useState<Appearance>();
  const [saving, setSaving] = useState(false);
  const [savedAppearance, setSavedAppearance] = useState<Appearance>();
  const [error, setError] = useState<string>();
  const updateInFlight = useRef(false);
  const language = usePreferenceForm(preferences, onPreferencesChange);

  const appearanceOptions: readonly AppearanceOption[] = [
    {
      value: "SYSTEM",
      label: t("settings.appearance.option.system"),
      description: t("settings.appearance.option.systemDescription"),
    },
    {
      value: "LIGHT",
      label: t("settings.appearance.option.light"),
      description: t("settings.appearance.option.lightDescription"),
    },
    {
      value: "DARK",
      label: t("settings.appearance.option.dark"),
      description: t("settings.appearance.option.darkDescription"),
    },
  ];

  const languageOptions: readonly LanguageOption[] = [
    {
      value: "system",
      label: LANGUAGE_NAMES.system,
      description: t("settings.language.option.systemDescription"),
    },
    {
      value: "zh-CN",
      label: LANGUAGE_NAMES["zh-CN"],
      description: t("settings.language.option.zhCNDescription"),
    },
    {
      value: "en",
      label: LANGUAGE_NAMES.en,
      description: t("settings.language.option.enDescription"),
    },
  ];

  async function selectAppearance(nextAppearance: Appearance) {
    if (
      updateInFlight.current ||
      nextAppearance === (pendingAppearance ?? appearance)
    ) {
      return;
    }

    updateInFlight.current = true;
    setPendingAppearance(nextAppearance);
    setSavedAppearance(undefined);
    setError(undefined);
    setSaving(true);

    try {
      await onAppearanceChange(nextAppearance);
      setSavedAppearance(nextAppearance);
    } catch (updateError) {
      setError(decodeAppError(updateError).message);
    } finally {
      setPendingAppearance(undefined);
      updateInFlight.current = false;
      setSaving(false);
    }
  }

  const selectedAppearance = pendingAppearance ?? appearance;
  const selectedLabel =
    appearanceOptions.find(
      (option) => option.value === selectedAppearance,
    )?.label ?? appearanceOptions[0].label;
  const savedLabel = savedAppearance
    ? appearanceOptions.find((option) => option.value === savedAppearance)
        ?.label
    : undefined;

  return (
    <SettingsForm busy={saving || language.saving}>
      <RadioCardGroup
        tip={<InfoTip description={t("settings.appearance.mode.tip")} title={t("settings.appearance.mode.label")} />}
        columns={3}
        label={t("settings.appearance.mode.label")}
        name="appearance"
        value={selectedAppearance}
        disabled={saving}
        options={appearanceOptions}
        onValueChange={(value) => void selectAppearance(value)}
      />

      <SettingsFeedback
        error={error ? t("settings.appearance.saveError", { message: error }) : undefined}
        statusTone={savedLabel ? "success" : "neutral"}
        status={
          saving
            ? t("settings.appearance.saving", { label: selectedLabel })
            : savedLabel
              ? t("settings.appearance.saved", { label: savedLabel })
              : t("settings.appearance.current", { label: selectedLabel })
        }
      />

      <RadioCardGroup
        tip={<InfoTip description={t("settings.language.tip")} title={t("settings.language.label")} />}
        columns={3}
        label={t("settings.language.label")}
        name="language"
        value={language.values.language}
        disabled={language.saving}
        options={languageOptions}
        onValueChange={(value) =>
          void language.update(t("settings.saveLabel.language"), {
            language: value as LanguagePreference,
          })
        }
      />

      <SettingsFeedback error={language.error} status={language.status} />

      <SettingsFieldList>
        <SettingsValueField
          label={t("settings.appearance.density.label")}
          description={t("settings.appearance.density.description")}
        >
          {t("settings.appearance.density.value")}
        </SettingsValueField>
        <SettingsValueField
          label={t("settings.appearance.motion.label")}
          description={t("settings.appearance.motion.description")}
        >
          {t("settings.appearance.motion.value")}
        </SettingsValueField>
      </SettingsFieldList>
    </SettingsForm>
  );
}
