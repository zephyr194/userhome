/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGeminiSettings,
  mapSchemaProperty,
  readmeSha256,
  sha256Hex,
  walkGeminiSettings,
} from "../../../scripts/lib/gemini-schema-merge.mjs";
import type {
  GeminiSetting,
  GeminiSnapshot,
  GeminiToolDefinition,
} from "../../../scripts/lib/gemini-schema-merge.mjs";
import { schemaIssues } from "./definitionSchemaIssues";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const definitionsDir = join(
  repoRoot,
  "src-tauri",
  "src",
  "ai_config",
  "definitions",
);
const definitionPath = join(definitionsDir, "gemini-cli.json");
const schemaPath = join(definitionsDir, "schema.json");
const snapshotPath = join(
  definitionsDir,
  "sources",
  "gemini-settings.schema.json",
);
const readmePath = join(definitionsDir, "sources", "README.md");
const reportPath = join(repoRoot, "docs", "ai-config-gemini-coverage.md");

const SNAPSHOT_SHA256 =
  "5517471627bf712c88e7d27ddbf419629df73edad7a676344ede9f2d2379d408";
const SNAPSHOT_TOP_LEVEL_COUNT = 26;
const SETTING_COUNT = 258;
const MAX_KEY_SEGMENTS = 3;
const SNAPSHOT_SOURCE = {
  url: "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json",
  retrievedOn: "2026-10-22",
  documentedVersion: "unknown",
};

type Node = Record<string, unknown>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function loadTool(): GeminiToolDefinition {
  const file = JSON.parse(readText(definitionPath)) as {
    tools: GeminiToolDefinition[];
  };
  const tool = file.tools.find((candidate) => candidate.id === "gemini-cli");
  if (!tool) {
    throw new Error("gemini-cli.json 缺少 gemini-cli");
  }
  return tool;
}

function loadSnapshot(): GeminiSnapshot {
  return JSON.parse(readText(snapshotPath)) as GeminiSnapshot;
}

describe("Gemini 官方 schema 快照", () => {
  it("快照 sha256 与 README 记录一致", () => {
    expect(sha256Hex(readText(snapshotPath))).toBe(SNAPSHOT_SHA256);
    expect(readmeSha256(readText(readmePath))).toBe(SNAPSHOT_SHA256);
  });

  it("设置项的 keyPath 集合与快照展开结果一致，最多三段且不含元键", () => {
    const snapshot = loadSnapshot();
    const settings = loadTool().settings;
    const keys = settings.map((setting) => setting.keyPath);
    const topLevel = new Set(keys.map((key) => key.split(".")[0]));

    expect(keys).toHaveLength(SETTING_COUNT);
    expect(new Set(keys)).toEqual(
      new Set(walkGeminiSettings(snapshot).map((entry) => entry.keyPath)),
    );
    expect(topLevel.size).toBe(SNAPSHOT_TOP_LEVEL_COUNT);
    expect(topLevel.has("$schema")).toBe(false);
    for (const key of keys) {
      expect(key.split(".").length, key).toBeLessThanOrEqual(MAX_KEY_SEGMENTS);
    }
  });

  it("重新生成快照得到已提交的设置项（无漂移）", () => {
    const committed = loadTool().settings;

    expect(buildGeminiSettings(loadSnapshot(), SNAPSHOT_SOURCE)).toEqual(committed);
  });

  it("枚举值与映射类型与快照一致，容器为 object，解析不了的键保持 unknown", () => {
    const snapshot = loadSnapshot();
    const definitions = snapshot.$defs ?? {};
    const byKey = new Map<string, GeminiSetting>(
      loadTool().settings.map((setting) => [setting.keyPath, setting]),
    );
    for (const entry of walkGeminiSettings(snapshot)) {
      const setting = byKey.get(entry.keyPath);
      if (setting === undefined) {
        throw new Error(`${entry.keyPath} 未收录`);
      }
      if (entry.target?.type === "object") {
        expect(setting.valueType, entry.keyPath).toBe("object");
      }
      const mapped = mapSchemaProperty(entry.property, definitions);
      if (mapped === null) {
        expect(setting.valueType, entry.keyPath).toBe("unknown");
      } else {
        expect(setting.valueType, entry.keyPath).toBe(mapped.valueType);
        expect(setting.allowedValues, entry.keyPath).toEqual(mapped.allowedValues);
      }
    }
  });

  it("没有任何键可编辑，风险键与秘密键也不可编辑", () => {
    const settings = loadTool().settings;

    expect(settings.filter((setting) => setting.coverage === "editable")).toEqual([]);
    const restricted = settings.filter(
      (setting: GeminiSetting) => setting.secret || setting.risks.length > 0,
    );
    expect(restricted.length).toBeGreaterThan(0);
    for (const setting of restricted) {
      expect(setting.coverage, setting.keyPath).not.toBe("editable");
    }
  });

  it("定义满足 definitions/schema.json 的结构约束", () => {
    const schema = JSON.parse(readText(schemaPath)) as Node;
    const file = JSON.parse(readText(definitionPath)) as unknown;

    expect(schemaIssues(file, schema, schema, "$")).toEqual([]);
  });

  it("覆盖报告记录快照 sha256，声明没有可编辑键，并保留产品迁移提示", () => {
    const report = readText(reportPath);

    expect(report).toContain(SNAPSHOT_SHA256);
    expect(report).toContain("本任务没有任何键可编辑");
    expect(report).toContain("Antigravity CLI on June 18th, 2026");
  });
});
