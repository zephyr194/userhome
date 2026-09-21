import type {
  PreferredEditorMode,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
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
    <div className="settings-form" aria-busy={form.saving}>
      <fieldset className="settings-choice-group">
        <legend>首选编辑器模式</legend>
        <p>仅在 catalog 授权相应能力时显示编辑器。</p>
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
          <label key={value} className="settings-choice">
            <input
              type="radio"
              name="preferred-editor-mode"
              value={value}
              checked={form.values.preferredEditorMode === value}
              onChange={() =>
                void form.update("首选编辑器模式", {
                  preferredEditorMode: value,
                })
              }
            />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <dl className="settings-summary-list settings-summary-list--compact">
        <div>
          <dt>备份保留</dt>
          <dd>
            <strong>{form.values.backupRetention} 份</strong>
            <span>每个受管配置独立计算；恢复前仍需预览与确认。</span>
          </dd>
        </div>
      </dl>

      {form.error ? (
        <p className="settings-form__error" role="alert">
          {form.error}
        </p>
      ) : form.status ? (
        <p className="settings-form__status" role="status">
          {form.status}
        </p>
      ) : null}
    </div>
  );
}
