import { describe, expect, it } from "vitest";
import { decodeToolReference } from "./aiConfigReference";

const GEMINI_URL = "https://geminicli.com/docs/reference/configuration/";
const NOTICE = `官方配置页与 GitHub README 均写明：未付费用户与 Google One 用户的 Gemini CLI 已于 2026-06-18 被 Antigravity CLI 替代（来源：${GEMINI_URL}，抓取日期 2026-10-22）。本机是否受影响无法从官方文档判断。`;

function source(overrides: Record<string, unknown> = {}) {
  return { url: GEMINI_URL, retrievedOn: "2026-10-22", documentedVersion: "unknown", ...overrides };
}

function resource(overrides: Record<string, unknown> = {}) {
  return {
    id: "gemini-user-settings",
    layer: "userLevel",
    format: "json",
    location: "{home}/.gemini/settings.json",
    coverage: "versionUnknown",
    description: "用户级设置文件，本快照不读取该文件。",
    descriptionTruncated: false,
    metadataOnly: false,
    sourceUrl: GEMINI_URL,
    ...overrides,
  };
}

function setting(overrides: Record<string, unknown> = {}) {
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
    risks: ["externalServer"],
    secret: false,
    sourceUrl: GEMINI_URL,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    snapshotComplete: false,
    coverageNote: "环境变量清单未逐项核实。",
    coverageNoteTruncated: false,
    sourceUrl: GEMINI_URL,
    ...overrides,
  };
}

function reference(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "gemini-cli",
    displayName: "Gemini CLI",
    source: source(),
    notices: [NOTICE],
    resources: [resource()],
    settings: [setting()],
    flagsCoverage: listing(),
    envCoverage: listing(),
    ...overrides,
  };
}

describe("decodeToolReference", () => {
  it("decodes a reference with its migration notice, resources and settings", () => {
    const decoded = decodeToolReference(reference(), "gemini-cli");

    expect(decoded.toolId).toBe("gemini-cli");
    expect(decoded.notices).toEqual([NOTICE]);
    expect(decoded.resources[0]).toMatchObject({ layer: "userLevel", metadataOnly: false });
    expect(decoded.settings[0]).toMatchObject({ keyPath: "mcpServers", valueType: "object" });
    expect(decoded.settings[0].risks).toEqual(["externalServer"]);
    expect(decoded.flagsCoverage.coverageNote).toBe("环境变量清单未逐项核实。");
  });

  it("accepts a tool without notices", () => {
    const decoded = decodeToolReference(
      reference({ toolId: "codex-cli", notices: [] }),
      "codex-cli",
    );

    expect(decoded.notices).toEqual([]);
  });

  it("accepts a null coverage note and a description cut at exactly 600 characters", () => {
    const cut = "字".repeat(600);
    const decoded = decodeToolReference(
      reference({
        settings: [setting({ description: cut, descriptionTruncated: true })],
        flagsCoverage: listing({ coverageNote: null }),
      }),
      "gemini-cli",
    );

    expect(decoded.settings[0].description).toBe(cut);
    expect(decoded.flagsCoverage.coverageNote).toBeNull();
  });

  it("rejects an unexpected or missing key at the top level and inside items", () => {
    expect(() => decodeToolReference({ ...reference(), path: "/Users/x" }, "gemini-cli")).toThrow();
    expect(() =>
      decodeToolReference(reference({ settings: [setting({ extra: 1 })] }), "gemini-cli"),
    ).toThrow();
    const withoutSecret = setting();
    Reflect.deleteProperty(withoutSecret, "secret");
    expect(() =>
      decodeToolReference(reference({ settings: [withoutSecret] }), "gemini-cli"),
    ).toThrow();
  });

  it("rejects a payload for a different tool than the one requested", () => {
    expect(() => decodeToolReference(reference(), "codex-cli")).toThrow();
  });

  it("rejects unknown tool ids and unknown enum values", () => {
    expect(() => decodeToolReference(reference({ toolId: "bogus" }), "gemini-cli")).toThrow();
    expect(() =>
      decodeToolReference(reference({ settings: [setting({ valueType: "date" })] }), "gemini-cli"),
    ).toThrow();
    expect(() =>
      decodeToolReference(reference({ resources: [resource({ coverage: "editable?" })] }), "gemini-cli"),
    ).toThrow();
    expect(() =>
      decodeToolReference(reference({ settings: [setting({ risks: ["deleteEverything"] })] }), "gemini-cli"),
    ).toThrow();
  });

  it("rejects a truncation flag that disagrees with the text length", () => {
    expect(() =>
      decodeToolReference(
        reference({ settings: [setting({ descriptionTruncated: true })] }),
        "gemini-cli",
      ),
    ).toThrow();
    expect(() =>
      decodeToolReference(
        reference({ settings: [setting({ description: "字".repeat(601) })] }),
        "gemini-cli",
      ),
    ).toThrow();
  });

  it("rejects control characters and blank text", () => {
    expect(() =>
      decodeToolReference(
        reference({ settings: [setting({ description: "line one\nline two" })] }),
        "gemini-cli",
      ),
    ).toThrow();
    expect(() =>
      decodeToolReference(reference({ displayName: "   " }), "gemini-cli"),
    ).toThrow();
  });

  it("rejects notices without an official https source or beyond the length limit", () => {
    expect(() =>
      decodeToolReference(reference({ notices: ["官方说明未附来源。"] }), "gemini-cli"),
    ).toThrow();
    expect(() =>
      decodeToolReference(
        reference({ notices: [`https://example.test/${"a".repeat(400)}`] }),
        "gemini-cli",
      ),
    ).toThrow();
  });

  it("rejects an enum setting without allowed values", () => {
    expect(() =>
      decodeToolReference(
        reference({ settings: [setting({ valueType: "enum", allowedValues: [] })] }),
        "gemini-cli",
      ),
    ).toThrow();
  });

  it("rejects locations without a placeholder, malformed dates and non-https sources", () => {
    expect(() =>
      decodeToolReference(
        reference({ resources: [resource({ location: "/Users/archie/.gemini/settings.json" })] }),
        "gemini-cli",
      ),
    ).toThrow();
    expect(() =>
      decodeToolReference(reference({ source: source({ retrievedOn: "2026/10/22" }) }), "gemini-cli"),
    ).toThrow();
    expect(() =>
      decodeToolReference(reference({ source: source({ url: "http://example.test" }) }), "gemini-cli"),
    ).toThrow();
  });

  it("rejects an oversized settings list and a non-object payload", () => {
    const settings = Array.from({ length: 1001 }, () => setting());
    expect(() => decodeToolReference(reference({ settings }), "gemini-cli")).toThrow();
    expect(() => decodeToolReference(null, "gemini-cli")).toThrow();
    expect(() => decodeToolReference([], "gemini-cli")).toThrow();
  });
});
