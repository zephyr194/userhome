import type {
  ReferenceCoverage,
  ReferenceLayer,
  ReferenceRisk,
  ReferenceSetting,
  ReferenceValueType,
  ToolReference,
} from "../../ipc/aiConfigReference";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { zhT, type AiBadgeTone } from "./aiConfigModel";

export const REFERENCE_PAGE_SIZE = 50;

export const REFERENCE_BANNER_KEY: MessageKey = "aiConfig.ref.banner";

export const VALUE_TYPE_LABELS: Record<ReferenceValueType, MessageKey> = {
  boolean: "aiConfig.ref.valueType.boolean",
  enum: "aiConfig.ref.valueType.enum",
  string: "aiConfig.ref.valueType.string",
  number: "aiConfig.ref.valueType.number",
  stringArray: "aiConfig.ref.valueType.stringArray",
  object: "aiConfig.ref.valueType.object",
  unknown: "aiConfig.ref.valueType.unknown",
};

export type ValueTypeFilter = "all" | ReferenceValueType;

export const VALUE_TYPE_FILTER_OPTIONS: readonly { value: ValueTypeFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "aiConfig.ref.valueType.all" },
  { value: "boolean", labelKey: VALUE_TYPE_LABELS.boolean },
  { value: "enum", labelKey: VALUE_TYPE_LABELS.enum },
  { value: "string", labelKey: VALUE_TYPE_LABELS.string },
  { value: "number", labelKey: VALUE_TYPE_LABELS.number },
  { value: "stringArray", labelKey: VALUE_TYPE_LABELS.stringArray },
  { value: "object", labelKey: VALUE_TYPE_LABELS.object },
  { value: "unknown", labelKey: VALUE_TYPE_LABELS.unknown },
];

export const COVERAGE_LABELS: Record<ReferenceCoverage, MessageKey> = {
  editable: "aiConfig.ref.coverage.editable",
  displayOnly: "aiConfig.ref.coverage.displayOnly",
  notApplicable: "aiConfig.ref.coverage.notApplicable",
  versionUnknown: "aiConfig.ref.coverage.versionUnknown",
  unsupported: "aiConfig.ref.coverage.unsupported",
};

export const COVERAGE_TONES: Record<ReferenceCoverage, AiBadgeTone> = {
  editable: "neutral",
  displayOnly: "neutral",
  notApplicable: "neutral",
  versionUnknown: "warning",
  unsupported: "warning",
};

export const LAYER_LABELS: Record<ReferenceLayer, MessageKey> = {
  userLevel: "aiConfig.ref.layer.userLevel",
  projectShared: "aiConfig.ref.layer.projectShared",
  projectLocal: "aiConfig.ref.layer.projectLocal",
  managed: "aiConfig.ref.layer.managed",
};

export const RISK_LABELS: Record<ReferenceRisk, MessageKey> = {
  executesCommand: "aiConfig.ref.risk.executesCommand",
  relaxesPermissions: "aiConfig.ref.risk.relaxesPermissions",
  externalServer: "aiConfig.ref.risk.externalServer",
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

export function formatVersionNote(reference: ToolReference, t: TranslateFunction = zhT): string {
  const { documentedVersion, retrievedOn } = reference.source;
  return t("aiConfig.ref.versionNote", {
    date: retrievedOn,
    version: documentedVersion === "unknown" ? t("aiConfig.ref.unknownVersion") : documentedVersion,
  });
}

export function listingStatusText(complete: boolean, t: TranslateFunction = zhT): string {
  return t(complete ? "aiConfig.ref.listing.complete" : "aiConfig.ref.listing.incomplete");
}
