import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodexSettings,
  CODEX_CLI_TOOL_ID,
  readmeSha256,
  renderCoverageReport,
  SCHEMA_FILE_NAME,
  sha256Hex,
  unresolvedReason,
} from "./lib/codex-schema-merge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFINITIONS_DIR = path.join(ROOT, "src-tauri/src/ai_config/definitions");
const DEFINITION_PATH = path.join(DEFINITIONS_DIR, "codex-cli.json");
const SOURCES_DIR = path.join(DEFINITIONS_DIR, "sources");
const SNAPSHOT_PATH = path.join(SOURCES_DIR, SCHEMA_FILE_NAME);
const README_PATH = path.join(SOURCES_DIR, "README.md");
const REPORT_PATH = path.join(ROOT, "docs/ai-config-codex-coverage.md");
const SNAPSHOT_URL = "https://developers.openai.com/codex/config-schema.json";
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
  const definitions = JSON.parse(definitionText);
  const tool = definitions.tools.find((candidate) => candidate.id === CODEX_CLI_TOOL_ID);
  if (!tool) {
    throw new Error(`codex-cli.json 中缺少 ${CODEX_CLI_TOOL_ID}`);
  }

  const source = { url: SNAPSHOT_URL, retrievedOn: SNAPSHOT_RETRIEVED_ON, documentedVersion: "unknown" };
  tool.settings = buildCodexSettings(snapshot, source);
  const mergedText = `${JSON.stringify(definitions, null, 2)}\n`;

  const unresolved = tool.settings
    .filter((setting) => setting.valueType === "unknown")
    .map((setting) => ({
      keyPath: setting.keyPath,
      reason: unresolvedReason(snapshot.properties[setting.keyPath], snapshot.definitions ?? {}),
    }));
  const riskItems = tool.settings
    .filter((setting) => setting.risks.length > 0 || setting.secret)
    .map(({ keyPath, risks, secret }) => ({ keyPath, risks, secret }));
  const reportText = renderCoverageReport({
    snapshotInfo: {
      url: SNAPSHOT_URL,
      retrievedOn: SNAPSHOT_RETRIEVED_ON,
      sha256: snapshotSha256,
      propertyCount: Object.keys(snapshot.properties ?? {}).length,
    },
    tool,
    unresolved,
    riskItems,
  });

  const definitionChanged = mergedText !== definitionText;
  const reportChanged =
    !fs.existsSync(REPORT_PATH) || reportText !== fs.readFileSync(REPORT_PATH, "utf8");

  if (check) {
    if (definitionChanged || reportChanged) {
      throw new Error(
        "codex-cli.json 或覆盖报告与快照不一致，请运行 node scripts/merge-codex-schema.mjs",
      );
    }
    console.log("codex-cli.json 与覆盖报告与快照一致");
    return;
  }

  if (!definitionChanged && !reportChanged) {
    console.log("codex-cli.json 与覆盖报告已与快照一致，未改动");
    return;
  }

  fs.writeFileSync(DEFINITION_PATH, mergedText);
  fs.writeFileSync(REPORT_PATH, reportText);
  console.log(
    `已更新 codex-cli.json：收录 ${tool.settings.length} 个顶层键，无法映射 ${unresolved.length} 个；报告 ${path.relative(ROOT, REPORT_PATH)}`,
  );
}

main(process.argv.slice(2));
