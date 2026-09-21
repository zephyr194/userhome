import type {
  OptionalDiscoveryRoot,
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";
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
  onDiscoveryRefresh: () => void;
  preferences: UserPreferences;
}) {
  const form = usePreferenceForm(preferences, onChange);

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
    if (
      await form.update("发现根偏好", {
        optionalDiscoveryRoots,
      })
    ) {
      onDiscoveryRefresh();
    }
  }

  return (
    <div className="settings-form" aria-busy={form.saving}>
      <fieldset className="settings-choice-group">
        <legend>元数据发现根</legend>
        <p>
          只读取一层目录项名称、类型和修改时间；不会读取候选配置内容，也不接受自定义路径。
        </p>
        {ROOTS.map((root) => (
          <label key={root.id} className="settings-choice">
            <input
              type="checkbox"
              checked={form.values.optionalDiscoveryRoots.includes(root.id)}
              disabled={form.saving}
              onChange={(event) =>
                void toggleRoot(root.id, event.currentTarget.checked)
              }
            />
            <span>
              <strong>{root.label}</strong>
              <small>{root.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="settings-control-list">
        <div className="settings-control-row" role="status">
          <span>
            <strong>当前活动根</strong>
            <small>保存后立即运行一次现有的有界刷新。</small>
          </span>
          <span className="settings-control-row__value">
            {form.values.optionalDiscoveryRoots.length} / {ROOTS.length}
          </span>
        </div>
        <div className="settings-control-row">
          <span>
            <strong>Catalog 授权边界</strong>
            <small>
              关闭发现根只隐藏该根的未知候选证据；catalog
              已授权文档的检测、读取和写入能力保持不变。
            </small>
          </span>
          <span className="settings-control-row__value">不变</span>
        </div>
      </div>

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
