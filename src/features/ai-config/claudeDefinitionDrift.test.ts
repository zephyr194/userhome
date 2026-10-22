/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mapSchemaType,
  mergeSchemaIntoDefinitions,
  SCHEMA_DEFAULT_PREFIX,
  serializeDefinitions,
} from "../../../scripts/lib/claude-schema-merge.mjs";
import type {
  Definitions,
  SchemaSnapshot,
} from "../../../scripts/lib/claude-schema-merge.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const definitionsDir = join(
  repoRoot,
  "src-tauri",
  "src",
  "ai_config",
  "definitions",
);
const definitionPath = join(definitionsDir, "claude-code.json");
const snapshotPath = join(
  definitionsDir,
  "sources",
  "claude-code-settings.schema.json",
);
const readmePath = join(definitionsDir, "sources", "README.md");
const editablePolicyPath = join(
  definitionsDir,
  "sources",
  "claude-editable-keys.json",
);

const DOCUMENTED_SETTING_COUNT = 245;
const PRE_MERGE_KEY_PATHS_SHA256 =
  "63176ec12ae1483b0603b202fc6058dc292a2fa2f5af117deb632eaae3f51523";
const KEPT_UNKNOWN = ["hooks", "fallbackModel"];
const KEPT_LOCAL_CONFLICTS = ["disableAutoMode"];
const EDITABLE_VALUE_TYPES = ["boolean", "enum", "string"];
const RESTRICTED_VALUE_TYPES = ["object", "stringArray", "unknown"];

interface SettingItem {
  id: string;
  keyPath: string;
  valueType: string;
  allowedValues: string[];
  defaultNote: string;
  coverage: string;
  risks: string[];
  secret: boolean;
  versions: { min: string; max: string } | null;
}

interface DefinitionFile {
  tools: { id: string; settings: SettingItem[] }[];
}

interface EditablePolicy {
  verifiedVersion: string;
  keys: string[];
  excluded: { keyPath: string; reason: string }[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readSnapshot(): SchemaSnapshot {
  return JSON.parse(readText(snapshotPath)) as SchemaSnapshot;
}

function claudeSettings(): SettingItem[] {
  const file = JSON.parse(readText(definitionPath)) as DefinitionFile;
  const tool = file.tools.find((candidate) => candidate.id === "claude-code");
  if (!tool) {
    throw new Error("claude-code tool is missing");
  }
  return tool.settings;
}

function topLevelSettings(): SettingItem[] {
  return claudeSettings().filter((setting) => !setting.keyPath.includes("."));
}

describe("Claude 官方 schema 快照", () => {
  it("快照 sha256 与 README 记录一致", () => {
    const recorded = /sha256：`([0-9a-f]{64})`/.exec(readText(readmePath));

    expect(recorded?.[1]).toBe(sha256(readText(snapshotPath)));
  });

  it("设置项的 keyPath 集合与合并前一致", () => {
    const keyPaths = claudeSettings()
      .map((setting) => setting.keyPath)
      .sort();

    expect(keyPaths).toHaveLength(DOCUMENTED_SETTING_COUNT);
    expect(sha256(keyPaths.join("\n"))).toBe(PRE_MERGE_KEY_PATHS_SHA256);
  });

  it("可编辑集合恰好是清单中的 58 个键，版本区间为单一的 2.1.287", () => {
    const policy = JSON.parse(readText(editablePolicyPath)) as EditablePolicy;
    const editable = claudeSettings().filter(
      (setting) => setting.coverage === "editable",
    );

    expect(policy.verifiedVersion).toBe("2.1.287");
    expect(editable).toHaveLength(58);
    expect(editable.map((setting) => setting.keyPath).sort()).toEqual(
      [...policy.keys].sort(),
    );
    for (const setting of editable) {
      expect(setting.versions, setting.keyPath).toEqual({
        min: "2.1.287",
        max: "2.1.287",
      });
    }
    for (const setting of claudeSettings()) {
      if (setting.coverage !== "editable") {
        expect(setting.versions, setting.keyPath).toBeNull();
      }
    }
  });

  it("风险键、秘密键、object、数组与 unknown 类型都不可编辑", () => {
    for (const setting of claudeSettings()) {
      const restricted =
        setting.risks.length > 0 ||
        setting.secret ||
        RESTRICTED_VALUE_TYPES.includes(setting.valueType);
      if (restricted) {
        expect(setting.coverage, setting.keyPath).not.toBe("editable");
      }
      if (setting.coverage === "editable") {
        expect(EDITABLE_VALUE_TYPES, setting.keyPath).toContain(
          setting.valueType,
        );
      }
    }
  });

  it("排除清单中的键保持 displayOnly", () => {
    const policy = JSON.parse(readText(editablePolicyPath)) as EditablePolicy;

    for (const { keyPath } of policy.excluded) {
      const setting = claudeSettings().find(
        (candidate) => candidate.keyPath === keyPath,
      );
      expect(setting?.coverage, keyPath).toBe("displayOnly");
    }
  });

  it("重新合并快照得到已提交的定义（无漂移）", () => {
    const definitions = JSON.parse(readText(definitionPath)) as Definitions;

    const { definitions: merged } = mergeSchemaIntoDefinitions(
      definitions,
      readSnapshot(),
    );

    expect(serializeDefinitions(merged)).toBe(readText(definitionPath));
  });

  it("已补全的顶层键类型与枚举值与快照一致", () => {
    const properties = readSnapshot().properties ?? {};
    for (const setting of topLevelSettings()) {
      if (
        setting.valueType === "unknown" ||
        KEPT_LOCAL_CONFLICTS.includes(setting.keyPath) ||
        properties[setting.keyPath] === undefined
      ) {
        continue;
      }
      const expected = mapSchemaType(properties[setting.keyPath]);
      expect(setting.valueType, setting.keyPath).toBe(expected?.valueType);
      expect(setting.allowedValues, setting.keyPath).toEqual(
        expected?.allowedValues,
      );
    }
  });

  it("按协调者决定保持 unknown 的键仍为 unknown", () => {
    for (const keyPath of KEPT_UNKNOWN) {
      const setting = topLevelSettings().find(
        (candidate) => candidate.keyPath === keyPath,
      );
      expect(setting?.valueType, keyPath).toBe("unknown");
    }
  });

  it("快照默认值已写入 defaultNote 且保留原文", () => {
    const properties = readSnapshot().properties ?? {};
    for (const setting of topLevelSettings()) {
      const property = properties[setting.keyPath];
      if (property?.default === undefined) {
        continue;
      }
      expect(setting.defaultNote, setting.keyPath).toContain(
        `${SCHEMA_DEFAULT_PREFIX}${JSON.stringify(property.default)}`,
      );
    }
  });
});
