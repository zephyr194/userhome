import type {
  PreferredEditorMode,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { BackupSettings } from "./BackupSettings";
import {
  SettingsChoice,
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsForm,
} from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

export function ConfigurationSettings({
  onChange,
  preferences,
}: {
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  preferences: UserPreferences;
}) {
  const form = usePreferenceForm(preferences, onChange);

  return (
    <SettingsForm busy={form.saving}>
      <SettingsChoiceGroup
        disabled={form.saving}
        legend="首选编辑器模式"
        description="仅在 catalog 授权相应能力时显示编辑器；此偏好不会授予新的配置写入权限。"
      >
        {(
          [
            [
              "STRUCTURED",
              "结构化",
              "优先使用受约束字段编辑器，必要时回退到 raw。",
            ],
            [
              "RAW",
              "Raw",
              "显式选择文本编辑器；仍保留预览、确认与写入策略。",
            ],
          ] as const satisfies readonly [
            PreferredEditorMode,
            string,
            string,
          ][]
        ).map(([value, label, description]) => (
          <SettingsChoice
            key={value}
            label={label}
            description={description}
          >
            <input
              className="mt-ui-xxs size-4 shrink-0 accent-primary"
              type="radio"
              name="preferred-editor-mode"
              value={value}
              checked={form.values.preferredEditorMode === value}
              disabled={form.saving}
              onChange={() =>
                void form.update("首选编辑器模式", {
                  preferredEditorMode: value,
                })
              }
            />
          </SettingsChoice>
        ))}
      </SettingsChoiceGroup>

      <BackupSettings
        onChange={onChange}
        preferences={preferences}
      />

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
