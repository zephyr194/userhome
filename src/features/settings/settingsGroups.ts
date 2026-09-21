export type SettingsGroupId =
  | "appearance"
  | "general"
  | "refresh"
  | "configuration"
  | "privacy"
  | "diagnostics"
  | "reset";

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  summary: string;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "appearance",
    label: "外观",
    summary: "主题、密度与动态效果",
  },
  {
    id: "general",
    label: "通用",
    summary: "启动、关闭与选择恢复",
  },
  {
    id: "refresh",
    label: "刷新",
    summary: "刷新时机与超时",
  },
  {
    id: "configuration",
    label: "配置与备份",
    summary: "编辑器与备份保留",
  },
  {
    id: "privacy",
    label: "隐私与发现",
    summary: "扫描范围与数据边界",
  },
  {
    id: "diagnostics",
    label: "诊断",
    summary: "本机状态与安全报告",
  },
  {
    id: "reset",
    label: "重置",
    summary: "恢复安全默认值",
  },
];
