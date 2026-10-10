import { Button, Panel, StatusBadge } from "../../../components/ui";
import type { ConfigPresetDefinition } from "../../../ipc/config";

const KIND_LABELS: Record<ConfigPresetDefinition["kind"], string> = {
  COMPLETE_TEMPLATE: "完整模板",
  FIELD_GROUP: "字段组",
  RECOMMENDED_VALUES: "推荐值",
};

export function PresetPicker({
  disabled,
  presets,
  selectedPresetId,
  onSelect,
}: {
  disabled: boolean;
  presets: ConfigPresetDefinition[];
  selectedPresetId?: string;
  onSelect: (preset: ConfigPresetDefinition) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <Panel className="min-w-0" aria-label="配置预设">
      <details className="config-workspace__presets">
        <summary>
          安全预设 · {presets.length} 项
          {selectedPresetId ? (
            <span className="ml-2 text-muted-foreground">
              已选择 {presets.find((preset) => preset.presetId === selectedPresetId)?.label}
            </span>
          ) : null}
        </summary>
        <div className="grid min-w-0 gap-2 px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            预设仅更新本地草稿，仍需预览差异并明确确认。
          </p>
          {presets.map((preset) => (
            <div
              className="grid min-w-0 gap-2 rounded-md border border-border p-2"
              key={`${preset.presetId}:${preset.presetVersion}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <strong className="min-w-0 break-words text-xs">
                  {preset.label}
                </strong>
                <StatusBadge>{KIND_LABELS[preset.kind]}</StatusBadge>
              </div>
              <p className="break-words text-xs leading-relaxed text-muted-foreground">
                {preset.description}
              </p>
              {preset.warnings.map((warning) => (
                <p className="break-words text-xs text-warning" key={warning}>
                  {warning}
                </p>
              ))}
              <Button
                className="justify-self-start"
                size="sm"
                variant={
                  selectedPresetId === preset.presetId ? "primary" : "secondary"
                }
                aria-pressed={selectedPresetId === preset.presetId}
                disabled={disabled || !preset.available}
                onClick={() => onSelect(preset)}
              >
                {preset.available ? "应用到草稿" : "当前不可用"}
              </Button>
            </div>
          ))}
        </div>
      </details>
    </Panel>
  );
}
