import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import type { ReferenceSetting } from "../../ipc/aiConfigReference";
import {
  COVERAGE_LABELS,
  COVERAGE_TONES,
  LAYER_LABELS,
  NO_FILTER,
  REFERENCE_PAGE_SIZE,
  RISK_LABELS,
  VALUE_TYPE_FILTER_OPTIONS,
  VALUE_TYPE_LABELS,
  filterSettings,
  formatVersionNote,
  isRiskOrSecret,
  nextShownCount,
  visiblePage,
} from "./toolReferenceModel";

function setting(overrides: Partial<ReferenceSetting> = {}): ReferenceSetting {
  return {
    id: "mcpServers",
    keyPath: "mcpServers",
    valueType: "object",
    allowedValues: [],
    description: "Configuration for MCP servers.",
    descriptionTruncated: false,
    defaultNote: "schema 默认值：{}",
    defaultNoteTruncated: false,
    coverage: "displayOnly",
    risks: [],
    secret: false,
    sourceUrl: "https://geminicli.com/docs/reference/configuration/",
    ...overrides,
  };
}

const SETTINGS: ReferenceSetting[] = [
  setting(),
  setting({
    id: "general.preferredEditor",
    keyPath: "general.preferredEditor",
    valueType: "enum",
    allowedValues: ["vim", "emacs"],
    description: "The editor to use.",
    risks: ["executesCommand"],
  }),
  setting({
    id: "telemetry.enabled",
    keyPath: "telemetry.enabled",
    valueType: "boolean",
    description: "Turns usage reporting on or off.",
  }),
  setting({
    id: "auth.token",
    keyPath: "auth.token",
    valueType: "string",
    description: "Access token.",
    secret: true,
  }),
];

describe("filterSettings", () => {
  it("returns every setting without a filter", () => {
    expect(filterSettings(SETTINGS, NO_FILTER)).toEqual(SETTINGS);
  });

  it("matches the key path or the description, ignoring case and surrounding spaces", () => {
    const byKey = filterSettings(SETTINGS, { ...NO_FILTER, query: "  TELEMETRY " });
    expect(byKey.map((item) => item.keyPath)).toEqual(["telemetry.enabled"]);

    const byDescription = filterSettings(SETTINGS, { ...NO_FILTER, query: "editor" });
    expect(byDescription.map((item) => item.keyPath)).toEqual(["general.preferredEditor"]);
  });

  it("filters by value type", () => {
    const enums = filterSettings(SETTINGS, { ...NO_FILTER, valueType: "enum" });
    expect(enums.map((item) => item.keyPath)).toEqual(["general.preferredEditor"]);
  });

  it("keeps only risky or secret keys when asked", () => {
    const risky = filterSettings(SETTINGS, { ...NO_FILTER, riskOnly: true });
    expect(risky.map((item) => item.keyPath)).toEqual([
      "general.preferredEditor",
      "auth.token",
    ]);
  });

  it("combines filters and can return nothing", () => {
    const none = filterSettings(SETTINGS, {
      query: "telemetry",
      valueType: "enum",
      riskOnly: true,
    });
    expect(none).toEqual([]);
  });
});

describe("isRiskOrSecret", () => {
  it("is true for a risk flag or a secret key, and false otherwise", () => {
    expect(isRiskOrSecret(setting({ risks: ["externalServer"] }))).toBe(true);
    expect(isRiskOrSecret(setting({ secret: true }))).toBe(true);
    expect(isRiskOrSecret(setting())).toBe(false);
  });
});

describe("visiblePage", () => {
  it("shows the first page and reports what remains", () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    const page = visiblePage(items, REFERENCE_PAGE_SIZE);

    expect(page.visible).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.remaining).toBe(70);
  });

  it("grows by one page at a time and never past the total", () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    const second = nextShownCount(REFERENCE_PAGE_SIZE, items.length);
    const third = nextShownCount(second, items.length);

    expect(visiblePage(items, second).visible).toHaveLength(100);
    expect(third).toBe(120);
    expect(visiblePage(items, third)).toEqual({
      visible: items,
      hasMore: false,
      remaining: 0,
    });
  });

  it("handles an empty list and a negative count without throwing", () => {
    expect(visiblePage([], REFERENCE_PAGE_SIZE)).toEqual({
      visible: [],
      hasMore: false,
      remaining: 0,
    });
    expect(visiblePage([1, 2], -3).visible).toEqual([]);
  });
});

describe("label maps", () => {
  it("name every value type, coverage status, layer and risk flag", () => {
    expect(Object.keys(VALUE_TYPE_LABELS).sort()).toEqual(
      ["boolean", "enum", "number", "object", "string", "stringArray", "unknown"],
    );
    expect(VALUE_TYPE_FILTER_OPTIONS[0]).toEqual({
      value: "all",
      labelKey: "aiConfig.ref.valueType.all",
    });
    expect(translate("zh-CN", VALUE_TYPE_FILTER_OPTIONS[0].labelKey)).toBe("全部类型");
    expect(Object.keys(COVERAGE_LABELS).sort()).toEqual(
      ["displayOnly", "editable", "notApplicable", "unsupported", "versionUnknown"],
    );
    expect(Object.keys(COVERAGE_TONES)).toEqual(Object.keys(COVERAGE_LABELS));
    expect(Object.keys(LAYER_LABELS)).toHaveLength(4);
    expect(Object.keys(RISK_LABELS)).toHaveLength(3);
  });
});

describe("formatVersionNote", () => {
  it("states an unknown documented version as unknown", () => {
    const text = formatVersionNote({
      toolId: "gemini-cli",
      displayName: "Gemini CLI",
      source: {
        url: "https://geminicli.com/docs/reference/configuration/",
        retrievedOn: "2026-10-22",
        documentedVersion: "unknown",
      },
      notices: [],
      resources: [],
      settings: [],
      flagsCoverage: {
        snapshotComplete: false,
        coverageNote: null,
        coverageNoteTruncated: false,
        sourceUrl: "https://geminicli.com/docs/reference/configuration/",
      },
      envCoverage: {
        snapshotComplete: false,
        coverageNote: null,
        coverageNoteTruncated: false,
        sourceUrl: "https://geminicli.com/docs/reference/configuration/",
      },
    });

    expect(text).toBe("抓取日期 2026-10-22，适用版本未知");
  });
});
