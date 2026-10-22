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

function isRecord(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

function schemaIssues(value: unknown, node: Node, root: Node, path: string): string[] {
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/$defs/", "");
    const target = (root.$defs as Record<string, Node>)[name];
    return schemaIssues(value, target, root, path);
  }
  if (Array.isArray(node.anyOf)) {
    const matched = (node.anyOf as Node[]).some(
      (branch) => schemaIssues(value, branch, root, path).length === 0,
    );
    return matched ? [] : [`${path}: 不匹配 anyOf 任一分支`];
  }
  if (typeof node.type === "string" && !matchesType(value, node.type)) {
    return [`${path}: 类型应为 ${node.type}`];
  }
  const issues: string[] = [];
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    issues.push(`${path}: 值不在 enum 中`);
  }
  if (node.const !== undefined && node.const !== value) {
    issues.push(`${path}: 值应为 ${String(node.const)}`);
  }
  if (typeof value === "string") {
    if (typeof node.minLength === "number" && value.length < node.minLength) {
      issues.push(`${path}: 长度不足`);
    }
    if (typeof node.maxLength === "number" && value.length > node.maxLength) {
      issues.push(`${path}: 超过最大长度`);
    }
    if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) {
      issues.push(`${path}: 不符合 pattern`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === "number" && value.length < node.minItems) {
      issues.push(`${path}: 元素数量不足`);
    }
    if (isRecord(node.items)) {
      value.forEach((item, index) =>
        issues.push(...schemaIssues(item, node.items as Node, root, `${path}[${index}]`)),
      );
    }
  }
  if (isRecord(value)) {
    const properties = (node.properties ?? {}) as Record<string, Node>;
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    for (const key of required) {
      if (!(key in value)) {
        issues.push(`${path}: 缺少 ${key}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        issues.push(...schemaIssues(child, properties[key], root, `${path}.${key}`));
      } else if (node.additionalProperties === false) {
        issues.push(`${path}: 未声明的键 ${key}`);
      }
    }
  }
  return issues;
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
