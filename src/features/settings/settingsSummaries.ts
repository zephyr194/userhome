import type { PreferencesState } from "../../app/shellState";
import type { UserPreferences } from "../../ipc/settings";
import type { SettingsGroupId } from "./settingsGroups";

export interface SettingSummary {
  label: string;
  value: string;
  description: string;
}

const APPEARANCE_LABELS: Record<UserPreferences["appearance"], string> = {
  SYSTEM: "跟随系统",
  LIGHT: "浅色",
  DARK: "深色",
};

const TIMEOUT_LABELS: Record<
  UserPreferences["providerTimeoutPreset"],
  string
> = {
  SHORT: "短",
  STANDARD: "标准",
  EXTENDED: "延长",
};

const EDITOR_LABELS: Record<UserPreferences["preferredEditorMode"], string> = {
  STRUCTURED: "优先结构化编辑器",
  RAW: "优先原始编辑器",
};

const ROOT_LABELS: Record<
  UserPreferences["optionalDiscoveryRoots"][number],
  string
> = {
  HOME: "~",
  XDG_CONFIG_HOME: "XDG 配置目录",
  APPLICATION_SUPPORT: "Application Support",
  HOMEBREW_PREFIX: "Homebrew 前缀",
};

function enabledLabel(enabled: boolean): string {
  return enabled ? "已启用" : "已关闭";
}

export function getSettingsSummaries(
  group: SettingsGroupId,
  preferences: UserPreferences,
  state: PreferencesState,
): readonly SettingSummary[] {
  switch (group) {
    case "appearance":
      return [
        {
          label: "外观",
          value: APPEARANCE_LABELS[preferences.appearance],
          description: "使用系统、浅色或深色语义颜色。",
        },
        {
          label: "界面密度",
          value: "紧凑",
          description: "固定窗口内保持桌面工具的信息密度。",
        },
        {
          label: "动态效果",
          value: "跟随系统",
          description: "尊重 macOS 的“减少动态效果”设置。",
        },
      ];
    case "general":
      return [
        {
          label: "启动时打开主窗口",
          value: enabledLabel(preferences.openWindowOnLaunch),
          description: "控制 UserHome 启动后的窗口可见性。",
        },
        {
          label: "关闭窗口",
          value:
            preferences.closeBehavior === "KEEP_RUNNING_IN_TRAY"
              ? "保留菜单栏运行"
              : "退出应用",
          description: "默认关闭窗口但保留本机后台能力。",
        },
        {
          label: "恢复选择",
          value: enabledLabel(preferences.restoreSelection),
          description: "仅恢复仍然存在且安全的分组或项目。",
        },
      ];
    case "refresh":
      return [
        {
          label: "启动时刷新",
          value: enabledLabel(preferences.refreshOnLaunch),
          description: "偏好加载完成后刷新本机提供程序。",
        },
        {
          label: "重新打开时刷新",
          value: enabledLabel(preferences.refreshOnReopen),
          description: "从菜单栏重新打开隐藏窗口时刷新。",
        },
        {
          label: "提供程序超时",
          value: TIMEOUT_LABELS[preferences.providerTimeoutPreset],
          description: "仅使用受限预设，不接受任意超时值。",
        },
        {
          label: "后台定时扫描",
          value: "关闭",
          description: "此版本不会在后台周期性扫描。",
        },
      ];
    case "configuration":
      return [
        {
          label: "首选编辑器",
          value: EDITOR_LABELS[preferences.preferredEditorMode],
          description: "可用时优先采用经过约束的编辑方式。",
        },
        {
          label: "备份保留",
          value: `${preferences.backupRetention} 份`,
          description: "只影响 UserHome 创建的配置备份。",
        },
        {
          label: "清理边界",
          value: "独立确认",
          description: "清理备份与偏好重置、托管配置修改彼此分离。",
        },
      ];
    case "privacy":
      return [
        {
          label: "可选发现根",
          value:
            preferences.optionalDiscoveryRoots
              .map((root) => ROOT_LABELS[root])
              .join("、") || "全部关闭",
          description: "仅显示预定义别名，不接受任意路径。",
        },
        {
          label: "发现内容",
          value: "仅元数据",
          description: "候选发现不会读取或展示配置内容。",
        },
        {
          label: "联网能力",
          value: "无遥测或云同步",
          description: "设置不会扩大文件系统或远程访问权限。",
        },
      ];
    case "diagnostics":
      return [
        {
          label: "偏好状态",
          value: state.status === "safe-default" ? "安全默认值" : "已验证",
          description:
            state.status === "safe-default"
              ? state.diagnostic.message
              : "已从版本化本机存储加载。",
        },
        {
          label: "偏好架构",
          value: `版本 ${preferences.schemaVersion}`,
          description: "未知或无效值不会静默进入运行时。",
        },
        {
          label: "报告边界",
          value: "已净化",
          description: "诊断不得包含配置内容、密钥、用户名或绝对主目录。",
        },
      ];
    case "reset":
      return [
        {
          label: "重置范围",
          value: "仅 UserHome 偏好",
          description: "恢复经过验证的安全默认值。",
        },
        {
          label: "应用配置",
          value: "保留",
          description: "不会修改任何受管应用的配置文件。",
        },
        {
          label: "配置备份",
          value: "保留",
          description: "删除备份始终是单独预览并确认的操作。",
        },
      ];
  }
}
