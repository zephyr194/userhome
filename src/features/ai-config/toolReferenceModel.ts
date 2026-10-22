import type {
  ReferenceCoverage,
  ReferenceLayer,
  ReferenceRisk,
  ReferenceSetting,
  ReferenceValueType,
  ToolReference,
} from "../../ipc/aiConfigReference";
import type { AiBadgeTone } from "./aiConfigModel";

export const REFERENCE_PAGE_SIZE = 50;

export const REFERENCE_BANNER_TEXT =
  "官方设置参考（只展示）：未读取本机配置文件，不可编辑。以下类型、默认值与说明均来自官方来源，不代表本机当前取值。";

export const VALUE_TYPE_LABELS: Record<ReferenceValueType, string> = {
  boolean: "开关",
  enum: "枚举",
  string: "文本",
  number: "数字",
  stringArray: "列表",
  object: "对象",
  unknown: "未知",
};

export type ValueTypeFilter = "all" | ReferenceValueType;

export const VALUE_TYPE_FILTER_OPTIONS: readonly { value: ValueTypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "boolean", label: VALUE_TYPE_LABELS.boolean },
  { value: "enum", label: VALUE_TYPE_LABELS.enum },
  { value: "string", label: VALUE_TYPE_LABELS.string },
  { value: "number", label: VALUE_TYPE_LABELS.number },
  { value: "stringArray", label: VALUE_TYPE_LABELS.stringArray },
  { value: "object", label: VALUE_TYPE_LABELS.object },
  { value: "unknown", label: VALUE_TYPE_LABELS.unknown },
];

export const COVERAGE_LABELS: Record<ReferenceCoverage, string> = {
  editable: "可编辑（本视图不开放）",
  displayOnly: "仅展示",
  notApplicable: "不适用",
  versionUnknown: "版本未确认，仅展示",
  unsupported: "不支持读取，仅展示元数据",
};

export const COVERAGE_TONES: Record<ReferenceCoverage, AiBadgeTone> = {
  editable: "neutral",
  displayOnly: "neutral",
  notApplicable: "neutral",
  versionUnknown: "warning",
  unsupported: "warning",
};

export const LAYER_LABELS: Record<ReferenceLayer, string> = {
  userLevel: "用户级",
  projectShared: "项目共享",
  projectLocal: "项目本地",
  managed: "托管（企业）",
};

export const RISK_LABELS: Record<ReferenceRisk, string> = {
  executesCommand: "执行命令",
  relaxesPermissions: "放宽权限",
  externalServer: "外部服务",
};

export interface SettingFilter {
  readonly query: string;
  readonly valueType: ValueTypeFilter;
  readonly riskOnly: boolean;
}

export const NO_FILTER: SettingFilter = { query: "", valueType: "all", riskOnly: false };

/** Risky or secret keys are the ones a reader most needs to find first. */
export function isRiskOrSecret(setting: ReferenceSetting): boolean {
  return setting.risks.length > 0 || setting.secret;
}

export function filterSettings(
  settings: readonly ReferenceSetting[],
  filter: SettingFilter,
): ReferenceSetting[] {
  const query = filter.query.trim().toLowerCase();
  return settings.filter((setting) => {
    if (filter.valueType !== "all" && setting.valueType !== filter.valueType) return false;
    if (filter.riskOnly && !isRiskOrSecret(setting)) return false;
    if (query.length === 0) return true;
    return (
      setting.keyPath.toLowerCase().includes(query) ||
      setting.description.toLowerCase().includes(query)
    );
  });
}

export interface VisiblePage<T> {
  readonly visible: readonly T[];
  readonly hasMore: boolean;
  readonly remaining: number;
}

export function visiblePage<T>(items: readonly T[], shown: number): VisiblePage<T> {
  const count = Math.min(Math.max(shown, 0), items.length);
  return {
    visible: items.slice(0, count),
    hasMore: count < items.length,
    remaining: items.length - count,
  };
}

export function nextShownCount(shown: number, total: number): number {
  return Math.min(total, shown + REFERENCE_PAGE_SIZE);
}

export function formatVersionNote(reference: ToolReference): string {
  const { documentedVersion, retrievedOn } = reference.source;
  const version = documentedVersion === "unknown" ? "未知" : documentedVersion;
  return `抓取日期 ${retrievedOn}，适用版本${version}`;
}

export function listingStatusText(complete: boolean): string {
  return complete ? "收录完整" : "收录不完整";
}
