import type {
  PreferredEditorMode,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { BackupSettings } from "./BackupSettings";
import { InfoTip, RadioCardGroup } from "../../components/ui";
import { SettingsFeedback, SettingsForm } from "./SettingsPrimitives";
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
      <RadioCardGroup
        tip={<InfoTip description="仅当该配置的授权允许时显示编辑器；此偏好不会授予新的配置写入权限。" title="首选编辑器模式" />}
        label="首选编辑器模式"
        name="preferred-editor-mode"
        value={form.values.preferredEditorMode}
        disabled={form.saving}
        options={[
          { value: "STRUCTURED", label: "结构化", description: "优先使用受约束字段编辑器，必要时回退到 raw。" },
          { value: "RAW", label: "Raw", description: "显式选择文本编辑器；仍保留预览、确认与写入策略。" },
        ]}
        onValueChange={(preferredEditorMode) => void form.update("首选编辑器模式", { preferredEditorMode: preferredEditorMode as PreferredEditorMode })}
      />

      <BackupSettings
        onChange={onChange}
        preferences={preferences}
      />

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
