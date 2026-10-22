import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CODE_TOOL_ID,
  editableCount,
  mergeSchemaIntoDefinitions,
  readmeSha256,
  renderCoverageReport,
  serializeDefinitions,
  sha256Hex,
} from "./lib/claude-schema-merge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFINITION_PATH = path.join(
  ROOT,
  "src-tauri/src/ai_config/definitions/claude-code.json",
);
const SOURCES_DIR = path.join(
  ROOT,
  "src-tauri/src/ai_config/definitions/sources",
);
const SNAPSHOT_PATH = path.join(SOURCES_DIR, "claude-code-settings.schema.json");
const README_PATH = path.join(SOURCES_DIR, "README.md");
const REPORT_PATH = path.join(ROOT, "docs/ai-config-claude-coverage.md");
const SNAPSHOT_URL = "https://www.schemastore.org/claude-code-settings.json";
const SNAPSHOT_RETRIEVED_ON = "2026-10-22";

function main(argv) {
  const check = argv.includes("--check");
  const unexpected = argv.filter((arg) => arg !== "--check");
  if (unexpected.length > 0) {
    throw new Error(`未知参数：${unexpected.join(" ")}`);
  }

  const snapshotText = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const snapshotSha256 = sha256Hex(snapshotText);
  const recordedSha256 = readmeSha256(fs.readFileSync(README_PATH, "utf8"));
  if (recordedSha256 !== snapshotSha256) {
    throw new Error(
      `快照 sha256 与 README 记录不一致：实际 ${snapshotSha256}，记录 ${recordedSha256}`,
    );
  }

  const snapshot = JSON.parse(snapshotText);
  const definitionText = fs.readFileSync(DEFINITION_PATH, "utf8");
  const { definitions, report } = mergeSchemaIntoDefinitions(
    JSON.parse(definitionText),
    snapshot,
  );
  if (editableCount(definitions) !== 0) {
    throw new Error("合并不得产生 editable 键");
  }
  const mergedText = serializeDefinitions(definitions);

  if (check) {
    if (mergedText !== definitionText) {
      throw new Error(
        "claude-code.json 与快照合并结果不一致，请运行 node scripts/merge-claude-schema.mjs",
      );
    }
    console.log("claude-code.json 与快照合并结果一致");
    return;
  }

  if (mergedText === definitionText) {
    console.log("claude-code.json 已与快照合并，未改动，覆盖报告保持不变");
    return;
  }

  const tool = definitions.tools.find((candidate) => candidate.id === CLAUDE_CODE_TOOL_ID);
  const properties = snapshot.properties ?? {};
  const localOnlyNested = tool.settings
    .map((setting) => setting.keyPath)
    .filter((keyPath) => keyPath.includes(".") || !(keyPath in properties));

  fs.writeFileSync(DEFINITION_PATH, mergedText);
  fs.writeFileSync(
    REPORT_PATH,
    renderCoverageReport({
      report,
      snapshotInfo: {
        url: SNAPSHOT_URL,
        retrievedOn: SNAPSHOT_RETRIEVED_ON,
        sha256: snapshotSha256,
      },
      localOnlyNested,
    }),
  );
  console.log(
    `已补全 ${report.completed.length} 个键；冲突 ${report.conflicts.length} 个；报告 ${path.relative(ROOT, REPORT_PATH)}`,
  );
}

main(process.argv.slice(2));
