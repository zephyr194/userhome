/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const DOCUMENTED_SETTING_COUNT = 245;
const PRE_MERGE_KEY_PATHS_SHA256 =
  "63176ec12ae1483b0603b202fc6058dc292a2fa2f5af117deb632eaae3f51523";

interface SettingItem {
  id: string;
  keyPath: string;
  valueType: string;
  allowedValues: string[];
  coverage: string;
}

interface DefinitionFile {
  tools: { id: string; settings: SettingItem[] }[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function claudeSettings(): SettingItem[] {
  const file = JSON.parse(readText(definitionPath)) as DefinitionFile;
  const tool = file.tools.find((candidate) => candidate.id === "claude-code");
  if (!tool) {
    throw new Error("claude-code tool is missing");
  }
  return tool.settings;
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

  it("没有任何设置项可编辑", () => {
    expect(
      claudeSettings().filter((setting) => setting.coverage === "editable"),
    ).toEqual([]);
  });
});
