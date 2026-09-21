import { useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import type { Appearance } from "../../ipc/settings";

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
    <div className="appearance-settings">
      <fieldset aria-busy={saving}>
        <legend>外观模式</legend>
        <div className="appearance-settings__options">
          {APPEARANCE_OPTIONS.map((option) => (
            <label key={option.value} className="appearance-option">
              <input
                type="radio"
                name="appearance"
                value={option.value}
                checked={selectedAppearance === option.value}
                onChange={() => void selectAppearance(option.value)}
              />
              <span className="appearance-option__card">
                <span
                  className={`appearance-option__preview appearance-option__preview--${option.value.toLowerCase()}`}
                  aria-hidden="true"
                >
                  <span />
                  <span />
                </span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p
        className={
          error
            ? "appearance-settings__status appearance-settings__status--error"
            : "appearance-settings__status"
        }
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        {error
          ? `无法保存外观：${error}`
          : saving
            ? `正在保存${selectedLabel}外观…`
            : savedLabel
              ? `已保存${savedLabel}外观。`
              : `当前使用${selectedLabel}外观。`}
      </p>

      <dl className="settings-summary-list">
        <div>
          <dt>界面密度</dt>
          <dd>
            <strong>紧凑</strong>
            <span>固定窗口内保持桌面工具的信息密度。</span>
          </dd>
        </div>
        <div>
          <dt>动态效果</dt>
          <dd>
            <strong>跟随系统</strong>
            <span>尊重 macOS 的“减少动态效果”设置。</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
