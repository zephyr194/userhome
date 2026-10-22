import { useId, useState } from "react";
import type {
  OptionalDiscoveryRoot,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
import { CheckboxField } from "../../components/ui";
import { SettingsFeedback, SettingsFieldList, SettingsForm, SettingsSection, SettingsTipRow, SettingsValueField } from "./SettingsPrimitives";
import { usePreferenceForm } from "./usePreferenceForm";

const ROOTS: readonly {
  id: OptionalDiscoveryRoot;
  label: string;
  description: string;
}[] = [
  {
    id: "HOME",
    label: "~/",
    description: "检查主目录下一层隐藏目录的名称和文件系统元数据。",
  },
  {
    id: "XDG_CONFIG_HOME",
    label: "XDG_CONFIG_HOME/",
    description: "检查受信任的 XDG 配置根；未设置时使用 ~/.config。",
  },
  {
    id: "APPLICATION_SUPPORT",
    label: "APPLICATION_SUPPORT/",
    description: "检查 macOS Application Support 根下一层条目。",
  },
  {
    id: "HOMEBREW_PREFIX",
    label: "HOMEBREW_PREFIX/etc/",
    description: "仅检查受信任 Homebrew 前缀中的 etc 元数据。",
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
        await form.update("发现根偏好", {
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
        description="只读取一层目录项名称、类型和修改时间；不会读取候选配置内容，也不接受自定义路径。"
        headingId={rootsHeadingId}
        title="元数据发现根"
      >
        <SettingsFieldList>
          {ROOTS.map((root) => (
            <SettingsTipRow key={root.id} className="py-ui-12" description={root.description} title={root.label}>
              <CheckboxField label={root.label} checked={form.values.optionalDiscoveryRoots.includes(root.id)} disabled={form.saving || refreshing} onCheckedChange={(checked) => void toggleRoot(root.id, checked)} />
            </SettingsTipRow>
          ))}
        </SettingsFieldList>
      </SettingsSection>

      <SettingsFieldList>
        <SettingsValueField
          label="当前活动根"
          description="保存后立即运行一次现有的有界刷新。"
          role="status"
        >
          {form.values.optionalDiscoveryRoots.length} / {ROOTS.length}
        </SettingsValueField>
        <SettingsValueField
          label="Catalog 授权边界"
          description="关闭发现根只隐藏该根的未知候选证据；catalog 已授权文档的检测、读取和写入能力保持不变。"
        >
          不变
        </SettingsValueField>
      </SettingsFieldList>

      <SettingsFeedback error={form.error} status={form.status} />
    </SettingsForm>
  );
}
