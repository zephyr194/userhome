import { useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import type { Appearance } from "../../ipc/settings";
import { RadioCardGroup } from "../../components/ui";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsValueField } from "./SettingsPrimitives";

interface AppearanceOption {
  description: string;
  label: string;
  value: Appearance;
}

const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  {
    value: "SYSTEM",
    label: "系统",
    description: "自动跟随 macOS 外观。",
  },
  {
    value: "LIGHT",
    label: "浅色",
    description: "始终使用浅色语义颜色。",
  },
  {
    value: "DARK",
    label: "深色",
    description: "始终使用深色语义颜色。",
  },
];

export function AppearanceSettings({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (appearance: Appearance) => Promise<void>;
}) {
  const [pendingAppearance, setPendingAppearance] = useState<Appearance>();
  const [saving, setSaving] = useState(false);
  const [savedAppearance, setSavedAppearance] = useState<Appearance>();
  const [error, setError] = useState<string>();
  const updateInFlight = useRef(false);

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
      await onChange(nextAppearance);
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
    APPEARANCE_OPTIONS.find(
      (option) => option.value === selectedAppearance,
    )?.label ?? "系统";
  const savedLabel = savedAppearance
    ? APPEARANCE_OPTIONS.find((option) => option.value === savedAppearance)
        ?.label
    : undefined;

  return (
    <SettingsForm busy={saving}>
      <RadioCardGroup
        columns={3}
        label="外观模式"
        description="选择系统、浅色或深色语义颜色；保存后立即应用。"
        name="appearance"
        value={selectedAppearance}
        disabled={saving}
        options={APPEARANCE_OPTIONS}
        onValueChange={(value) => void selectAppearance(value)}
      />

      <SettingsFeedback
        error={error ? `无法保存外观：${error}` : undefined}
        statusTone={savedLabel ? "success" : "neutral"}
        status={
          saving
            ? `正在保存${selectedLabel}外观…`
            : savedLabel
              ? `已保存${savedLabel}外观。`
              : `当前使用${selectedLabel}外观。`
        }
      />

      <SettingsFieldList>
        <SettingsValueField
          label="界面密度"
          description="固定窗口内保持桌面工具的信息密度。"
        >
          紧凑
        </SettingsValueField>
        <SettingsValueField
          label="动态效果"
          description="尊重 macOS 的“减少动态效果”设置。"
        >
          跟随系统
        </SettingsValueField>
      </SettingsFieldList>
    </SettingsForm>
  );
}
