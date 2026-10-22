/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCodexSettings,
  mapSchemaProperty,
  readmeSha256,
  sha256Hex,
} from "../../../scripts/lib/codex-schema-merge.mjs";
import type {
  CodexSetting,
  CodexSnapshot,
  CodexToolDefinition,
} from "../../../scripts/lib/codex-schema-merge.mjs";
import { schemaIssues } from "./definitionSchemaIssues";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const definitionsDir = join(
  repoRoot,
  "src-tauri",
  "src",
  "ai_config",
  "definitions",
);
const definitionPath = join(definitionsDir, "codex-cli.json");
const schemaPath = join(definitionsDir, "schema.json");
const snapshotPath = join(
  definitionsDir,
  "sources",
  "codex-config.schema.json",
);
const readmePath = join(definitionsDir, "sources", "README.md");
const reportPath = join(repoRoot, "docs", "ai-config-codex-coverage.md");

const SNAPSHOT_SHA256 =
  "e9dd16b9d1710e57b020e42da4af6d6606e8f44cb028a2e94196dee3890d9170";
const SNAPSHOT_TOP_LEVEL_COUNT = 103;
const SNAPSHOT_SOURCE = {
  url: "https://developers.openai.com/codex/config-schema.json",
  retrievedOn: "2026-10-22",
  documentedVersion: "unknown",
};

type Node = Record<string, unknown>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function loadTool(): CodexToolDefinition {
  const file = JSON.parse(readText(definitionPath)) as {
    tools: CodexToolDefinition[];
  };
  const tool = file.tools.find((candidate) => candidate.id === "codex-cli");
  if (!tool) {
    throw new Error("codex-cli.json 缺少 codex-cli");
  }
  return tool;
}

function loadSnapshot(): CodexSnapshot {
  return JSON.parse(readText(snapshotPath)) as CodexSnapshot;
}

describe("Codex 官方 schema 快照", () => {
  it("快照 sha256 与 README 记录一致", () => {
    expect(sha256Hex(readText(snapshotPath))).toBe(SNAPSHOT_SHA256);
    expect(readmeSha256(readText(readmePath))).toBe(SNAPSHOT_SHA256);
  });

  it("设置项的 keyPath 集合与快照顶层键一致", () => {
    const snapshot = loadSnapshot();
    const keys = loadTool().settings.map((setting) => setting.keyPath);

    expect(keys).toHaveLength(SNAPSHOT_TOP_LEVEL_COUNT);
    expect(new Set(keys)).toEqual(new Set(Object.keys(snapshot.properties ?? {})));
  });

  it("重新生成快照得到已提交的设置项（无漂移）", () => {
    const committed = loadTool().settings;

    expect(buildCodexSettings(loadSnapshot(), SNAPSHOT_SOURCE)).toEqual(committed);
  });

  it("枚举值与快照的 enum 或 oneOf 一致，解析不了的键保持 unknown", () => {
    const snapshot = loadSnapshot();
    const definitions = snapshot.definitions ?? {};
    for (const setting of loadTool().settings) {
      const property = snapshot.properties?.[setting.keyPath];
      if (property === undefined) {
        throw new Error(`${setting.keyPath} 不在快照中`);
      }
      const mapped = mapSchemaProperty(property, definitions);
      if (mapped === null) {
        expect(setting.valueType, setting.keyPath).toBe("unknown");
      } else {
        expect(setting.valueType, setting.keyPath).toBe(mapped.valueType);
        expect(setting.allowedValues, setting.keyPath).toEqual(mapped.allowedValues);
      }
    }
  });

  it("没有任何键可编辑，风险键与秘密键也不可编辑", () => {
    const settings = loadTool().settings;

    expect(settings.filter((setting) => setting.coverage === "editable")).toEqual([]);
    const restricted = settings.filter(
      (setting: CodexSetting) => setting.secret || setting.risks.length > 0,
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

  it("覆盖报告记录快照 sha256，并声明本任务没有可编辑键", () => {
    const report = readText(reportPath);

    expect(report).toContain(SNAPSHOT_SHA256);
    expect(report).toContain("本任务没有任何键可编辑");
  });
});
