import { createHash } from "node:crypto";

export const CODEX_CLI_TOOL_ID = "codex-cli";
export const SCHEMA_FILE_NAME = "codex-config.schema.json";
export const SCHEMA_DEFAULT_PREFIX = "schema 默认值：";
export const SCHEMA_NO_DEFAULT = "schema 未声明默认值";
export const MERGE_RULE_UNVERIFIED = "文档未给出合并规则（未核实）";
export const MISSING_DESCRIPTION = "schema 未提供描述（未核实）";

const MAX_REF_DEPTH = 8;
const RISK_ORDER = ["executesCommand", "relaxesPermissions", "externalServer"];
const RISK_RULES = [
  {
    risk: "executesCommand",
    pattern: /command|script|executable|hook|spawn|shell|wrapper/i,
  },
  {
    risk: "relaxesPermissions",
    pattern: /approv|sandbox|permission|danger|bypass|auto[_ -]?review|skip/i,
  },
  {
    risk: "externalServer",
    pattern: /MCP|marketplace|plugin|OAuth|server|endpoint|provider|_url|websocket|webrtc|gateway|remote/i,
  },
];
const SECRET_KEY_PATTERN =
  /credential|secret|password|api_?key|(access|refresh|auth)_?token(?!_?limit)|_auth$/i;
const SECRET_TEXT_PATTERN =
  /\b(credentials?|secrets?|passwords?|api keys?|access tokens?|refresh tokens?)\b/i;

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function readmeSha256(readmeText) {
  const section = readmeText
    .split(/\n(?=# )/)
    .find((part) => part.includes(SCHEMA_FILE_NAME));
  const match = section ? /sha256：`([0-9a-f]{64})`/.exec(section) : null;
  return match ? match[1] : null;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function simple(valueType) {
  return { valueType, allowedValues: [] };
}

function lookup(ref, definitions) {
  const match = /^#\/definitions\/([A-Za-z0-9_]+)$/.exec(ref);
  return match ? definitions[match[1]] : undefined;
}

function resolve(node, definitions, depth = 0) {
  if (depth > MAX_REF_DEPTH || !isObject(node)) {
    return null;
  }
  if (typeof node.$ref === "string") {
    return resolve(lookup(node.$ref, definitions), definitions, depth + 1);
  }
  if (Array.isArray(node.allOf)) {
    const [only] = node.allOf;
    if (node.allOf.length !== 1 || !isObject(only) || typeof only.$ref !== "string") {
      return null;
    }
    return resolve(only, definitions, depth + 1);
  }
  return node;
}

function enumOf(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "string")) {
    return null;
  }
  return { valueType: "enum", allowedValues: [...new Set(values)] };
}

function mapOneOf(branches) {
  const values = [];
  for (const branch of branches) {
    if (!isObject(branch) || branch.type !== "string" || !Array.isArray(branch.enum)) {
      return null;
    }
    values.push(...branch.enum);
  }
  return enumOf(values);
}

function mapNode(node) {
  if (!isObject(node) || node.anyOf || node.allOf || node.not) {
    return null;
  }
  if (Array.isArray(node.oneOf)) {
    return mapOneOf(node.oneOf);
  }
  switch (node.type) {
    case "boolean":
      return simple("boolean");
    case "string":
      return node.enum === undefined ? simple("string") : enumOf(node.enum);
    case "integer":
    case "number":
      return simple("number");
    case "array":
      return isObject(node.items) &&
        node.items.type === "string" &&
        node.items.enum === undefined &&
        node.items.$ref === undefined
        ? simple("stringArray")
        : null;
    case "object":
      return node.properties === undefined && node.additionalProperties === undefined
        ? simple("object")
        : null;
    default:
      return null;
  }
}

export function mapSchemaProperty(property, definitions) {
  if (!isObject(property)) {
    return null;
  }
  if (property.type === "object") {
    return simple("object");
  }
  return mapNode(resolve(property, definitions));
}

export function unresolvedReason(property, definitions) {
  if (!isObject(property)) {
    return "属性不是对象";
  }
  const target = resolve(property, definitions);
  if (target === null) {
    return "$ref 无法解析或组合形式不受支持";
  }
  if (target.anyOf) {
    return "anyOf 无法映射为单一类型";
  }
  if (Array.isArray(target.oneOf)) {
    return "oneOf 含非字符串枚举分支";
  }
  if (target.type === "object") {
    return "结构化对象（带 properties 或 additionalProperties 的定义）";
  }
  if (target.type === "array") {
    return "数组元素不是字符串";
  }
  return "类型无法映射";
}

export function classifyRisks(keyPath, description) {
  const text = `${keyPath} ${description}`;
  const risks = RISK_ORDER.filter((risk) =>
    RISK_RULES.find((rule) => rule.risk === risk).pattern.test(text),
  );
  const secret = SECRET_KEY_PATTERN.test(keyPath) || SECRET_TEXT_PATTERN.test(description);
  return { risks, secret };
}

export function buildCodexSettings(snapshot, source) {
  const definitions = snapshot.definitions ?? {};
  return Object.entries(snapshot.properties ?? {}).map(([keyPath, property]) => {
    const hasDescription =
      typeof property.description === "string" && property.description.trim() !== "";
    const description = hasDescription ? property.description : MISSING_DESCRIPTION;
    const mapped = mapSchemaProperty(property, definitions);
    const { risks, secret } = classifyRisks(keyPath, hasDescription ? property.description : "");
    return {
      id: keyPath,
      keyPath,
      valueType: mapped ? mapped.valueType : "unknown",
      allowedValues: mapped ? mapped.allowedValues : [],
      description,
      defaultNote:
        property.default === undefined
          ? SCHEMA_NO_DEFAULT
          : `${SCHEMA_DEFAULT_PREFIX}${JSON.stringify(property.default)}`,
      mergeRule: MERGE_RULE_UNVERIFIED,
      risks,
      secret,
      coverage: "displayOnly",
      versions: null,
      source: { ...source },
    };
  });
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  }
  return counts;
}

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderCoverageReport({ snapshotInfo, tool, unresolved, riskItems }) {
  const settings = tool.settings;
  const typeCounts = countBy(settings, "valueType");
  const editable = settings.filter((setting) => setting.coverage === "editable").length;
  const typeRows = [...typeCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([valueType, count]) => [valueType, count]);
  const resourceRows = tool.resources.map((resource) => [
    escapeCell(resource.id),
    resource.layer,
    resource.format,
    escapeCell(resource.location),
    resource.coverage,
    escapeCell(resource.source.url),
  ]);
  const unverifiedResources = tool.resources.filter(
    (resource) => resource.coverage !== "displayOnly",
  );

  return [
    "# Codex CLI 覆盖报告",
    "",
    "本报告由 `scripts/merge-codex-schema.mjs` 生成，请勿手动编辑。",
    "",
    "## 快照",
    "",
    `- 原始 URL：${snapshotInfo.url}`,
    `- 抓取日期：${snapshotInfo.retrievedOn}`,
    `- sha256：\`${snapshotInfo.sha256}\``,
    "- 托管方：OpenAI 官方托管；schema 不声明适用的 Codex 版本。",
    "",
    "## 收录与可编辑性",
    "",
    `- 顶层键：快照 ${snapshotInfo.propertyCount} 个，定义收录 ${settings.length} 个，一一对应。`,
    `- 可编辑键：${editable} 个。本任务没有任何键可编辑（所有设置项为 displayOnly，本工具没有已验证版本区间）。`,
    "- flags / env：本任务未收录，`flagsCoverage` 与 `envCoverage` 标注 `snapshotComplete: false`，待 AI-8 补充。",
    "",
    "## 按类型数量",
    "",
    table(["valueType", "数量"], typeRows),
    "",
    "## 解析不了的键（valueType = unknown）",
    "",
    unresolved.length === 0
      ? "无。"
      : table(
          ["键", "原因"],
          unresolved.map(({ keyPath, reason }) => [escapeCell(keyPath), reason]),
        ),
    "",
    "## 风险与秘密标注",
    "",
    "标注规则：风险与秘密由键名与 schema 描述的关键词匹配得出，宁可多标；协调者需复核。",
    "",
    riskItems.length === 0
      ? "无。"
      : table(
          ["键", "风险", "秘密"],
          riskItems.map(({ keyPath, risks, secret }) => [
            escapeCell(keyPath),
            risks.length === 0 ? "-" : risks.join("、"),
            secret ? "是" : "-",
          ]),
        ),
    "",
    "## 资源与核实来源",
    "",
    table(["资源", "层级", "格式", "位置", "能力状态", "来源"], resourceRows),
    "",
    "资源的说明文字见 `codex-cli.json`。认证与凭据类资源为仅元数据：只标注存在性，不读取内容。",
    "",
    "## 未核实项",
    "",
    "- 用户级 `config.toml` 的默认位置与 `CODEX_HOME` 重定位语义：未核实。",
    "- 项目级 `.codex/config.toml` 与项目信任规则：未核实。",
    "- 系统/托管层路径与格式：未核实。",
    "- 配置优先级（CLI `-c`、profile、项目、用户、系统、默认值）：未核实。",
    "- 所有设置项的合并规则：文档未给出（未核实）。",
    "- 可执行文件名 `codex`：来自任务简报，未经官方核实。",
    ...unverifiedResources.map(
      (resource) => `- 资源 \`${resource.id}\` 能力状态为 ${resource.coverage}：${resource.description}`,
    ),
    "",
  ].join("\n");
}
