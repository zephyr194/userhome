/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { schemaIssues } from "./definitionSchemaIssues";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const definitionsDir = join(
  repoRoot,
  "src-tauri",
  "src",
  "ai_config",
  "definitions",
);
const definitionPath = join(definitionsDir, "copilot-cli.json");
const schemaPath = join(definitionsDir, "schema.json");
const sourcePath = join(definitionsDir, "sources", "copilot-cli-docs.md");
const readmePath = join(definitionsDir, "sources", "README.md");
const reportPath = join(repoRoot, "docs", "ai-config-copilot-coverage.md");

const CONFIG_DIR_URL =
  "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference";
const SOURCE_DATE = "2026-10-22";
const SETTING_COUNT = 90;

interface CopilotSetting {
  id: string;
  keyPath: string;
  valueType: string;
  allowedValues: string[];
  risks: string[];
  secret: boolean;
  coverage: string;
  source: { url: string; retrievedOn: string; documentedVersion: string };
}

interface CopilotResource {
  id: string;
  description: string;
  coverage: string;
}

interface CopilotTool {
  id: string;
  executableNames: string[];
  resources: CopilotResource[];
  settings: CopilotSetting[];
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function loadTool(): CopilotTool {
  const file = JSON.parse(readText(definitionPath)) as { tools: CopilotTool[] };
  const tool = file.tools.find((candidate) => candidate.id === "copilot-cli");
  if (!tool) {
    throw new Error("copilot-cli.json 缺少 copilot-cli");
  }
  return tool;
}

describe("Copilot CLI 官方文档来源", () => {
  it("来源记录存在，记录主来源 URL、抓取日期与“未找到 JSON Schema”的说明", () => {
    const source = readText(sourcePath);

    expect(source).toContain(CONFIG_DIR_URL);
    expect(source).toContain(SOURCE_DATE);
    expect(source).toContain("JSON Schema");
    expect(readText(readmePath)).toContain("copilot-cli-docs.md");
  });

  it("每个设置项都带官方来源 URL、抓取日期与 documentedVersion", () => {
    const settings = loadTool().settings;

    expect(settings).toHaveLength(SETTING_COUNT);
    for (const setting of settings) {
      expect(setting.source.url, setting.keyPath).toBe(CONFIG_DIR_URL);
      expect(setting.source.retrievedOn, setting.keyPath).toBe(SOURCE_DATE);
      expect(setting.source.documentedVersion, setting.keyPath).toBe("unknown");
    }
  });

  it("非 unknown 的类型只来自文档表格：键名与可选值都能在来源记录中找到", () => {
    const source = readText(sourcePath);

    for (const setting of loadTool().settings) {
      expect(setting.valueType, setting.keyPath).not.toBe("unknown");
      expect(source, setting.keyPath).toContain(`| \`${setting.keyPath}\` |`);
      for (const value of setting.allowedValues) {
        expect(source, `${setting.keyPath}=${value}`).toContain(`"${value}"`);
      }
    }
  });

  it("没有任何键可编辑", () => {
    const tool = loadTool();

    expect(
      tool.settings.filter((setting) => setting.coverage === "editable"),
    ).toEqual([]);
    expect(
      tool.settings.filter((setting) => setting.coverage !== "displayOnly"),
    ).toEqual([]);
  });

  it("风险键与秘密键不可编辑，且确实存在这类键", () => {
    const restricted = loadTool().settings.filter(
      (setting) => setting.secret || setting.risks.length > 0,
    );

    expect(restricted.length).toBeGreaterThan(0);
    for (const setting of restricted) {
      expect(setting.coverage, setting.keyPath).not.toBe("editable");
    }
  });

  it("认证与凭据资源只标注存在性，能力状态不可编辑", () => {
    const tool = loadTool();

    for (const id of [
      "copilot-config-state",
      "copilot-mcp-oauth-fallback",
      "copilot-mcp-secrets-fallback",
    ]) {
      const resource = tool.resources.find((item) => item.id === id);
      expect(resource, id).toBeDefined();
      expect(resource?.description, id).toContain("仅元数据");
      expect(resource?.coverage, id).not.toBe("editable");
    }
  });

  it("定义满足 definitions/schema.json 的结构约束", () => {
    const schema = JSON.parse(readText(schemaPath)) as Record<string, unknown>;
    const file = JSON.parse(readText(definitionPath)) as unknown;

    expect(schemaIssues(file, schema, schema, "$")).toEqual([]);
  });

  it("覆盖报告记录冲突裁决与“本任务没有任何键可编辑”", () => {
    const report = readText(reportPath);

    expect(report).toContain("本任务没有任何键可编辑");
    expect(report).toContain("冲突与未核实");
    expect(report).toContain("reasoningEffort");
    expect(report).toContain("effortLevel");
    expect(report).toContain("banner");
    expect(report).toContain("config.json");
  });
});
