import { createHash } from "node:crypto";

export const GEMINI_CLI_TOOL_ID = "gemini-cli";
export const SCHEMA_FILE_NAME = "gemini-settings.schema.json";
export const SCHEMA_DEFAULT_PREFIX = "schema 默认值：";
export const SCHEMA_NO_DEFAULT = "schema 未声明默认值";
export const MERGE_RULE_UNVERIFIED = "文档未给出合并规则（未核实）";
export const MISSING_DESCRIPTION = "schema 未提供描述（未核实）";
export const MAX_KEY_DEPTH = 3;
// 元键声明 schema 版本而非设置项，且 keyPath 格式不允许 `$`。
export const SKIPPED_TOP_LEVEL_KEYS = ["$schema"];

const MAX_REF_DEPTH = 8;
const RISK_ORDER = ["executesCommand", "relaxesPermissions", "externalServer"];
const RISK_RULES = [
  {
    risk: "executesCommand",
    pattern: /command|script|executable|binary|hook|spawn|shell|wrapper|pager|editor|exec|cmd/i,
  },
  {
    risk: "relaxesPermissions",
    pattern:
      /approv|sandbox|permission|danger|bypass|yolo|trust|allow|always|skip|policy|confirm|auto[_ -]?(accept|add)|unattended|non-?interactive/i,
  },
  {
    risk: "externalServer",
    pattern:
      /MCP|marketplace|plugin|OAuth|server|endpoint|provider|URI|URL|websocket|gateway|remote|extension|otlp|telemetry|registry|collector|host|network/i,
  },
];
const SECRET_KEY_PATTERN = /credential|secret|password|api_?key|apikey|auth|header|token(?!s)/i;
const SECRET_TEXT_PATTERN =
  /\b(credentials?|secrets?|passwords?|api keys?|access tokens?|refresh tokens?|auth tokens?)\b/i;

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

function enumOf(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "string")) {
    return null;
  }
  return { valueType: "enum", allowedValues: [...new Set(values)] };
}

function lookup(ref, definitions) {
  const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  return match ? definitions[match[1]] : undefined;
}

export function resolveNode(node, definitions, depth = 0) {
  if (depth > MAX_REF_DEPTH || !isObject(node)) {
    return null;
  }
  if (typeof node.$ref === "string") {
    const target = lookup(node.$ref, definitions);
    return target === undefined ? null : resolveNode(target, definitions, depth + 1);
  }
  return node;
}

function isMap(target) {
  return target.type === "object" && (target.additionalProperties === true || isObject(target.additionalProperties));
}

function isExpandable(target) {
  return target.type === "object" && isObject(target.properties) && !isMap(target);
}

function mapTarget(target) {
  if (target.type === "object") {
    return simple("object");
  }
  if (target.anyOf || target.allOf || target.oneOf || target.not) {
    return null;
  }
  switch (target.type) {
    case "boolean":
      return simple("boolean");
    case "string":
      return target.enum === undefined ? simple("string") : enumOf(target.enum);
    case "integer":
    case "number":
      return simple("number");
    case "array":
      return isObject(target.items) &&
        target.items.type === "string" &&
        target.items.enum === undefined &&
        target.items.$ref === undefined
        ? simple("stringArray")
        : null;
    default:
      return null;
  }
}

export function mapSchemaProperty(property, definitions) {
  const target = resolveNode(property, definitions);
  return target === null ? null : mapTarget(target);
}

export function unresolvedReason(property, definitions) {
  const target = resolveNode(property, definitions);
  if (target === null) {
    return "$ref 无法解析";
  }
  if (target.anyOf) {
    return "anyOf 无法映射为单一类型";
  }
  if (target.type === "array") {
    return "数组元素不是字符串";
  }
  if (target.type === undefined) {
    return "未声明 type";
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

// 深度按 keyPath 段数计算：顶层键为第 1 段，最多展开到 MAX_KEY_DEPTH 段。
export function walkGeminiSettings(snapshot) {
  const definitions = snapshot.$defs ?? {};
  const entries = [];
  const visit = (keyPath, property, depth) => {
    const target = resolveNode(property, definitions);
    const expandable = target !== null && isExpandable(target);
    let collapsed = null;
    if (target !== null && isMap(target)) {
      collapsed = "map";
    } else if (expandable && depth >= MAX_KEY_DEPTH) {
      collapsed = "depth";
    }
    entries.push({ keyPath, property, target, collapsed });
    if (expandable && depth < MAX_KEY_DEPTH) {
      for (const [child, childProperty] of Object.entries(target.properties)) {
        visit(`${keyPath}.${child}`, childProperty, depth + 1);
      }
    }
  };
  for (const [name, property] of Object.entries(snapshot.properties ?? {})) {
    if (!SKIPPED_TOP_LEVEL_KEYS.includes(name)) {
      visit(name, property, 1);
    }
  }
  return entries;
}

function descriptionOf(property, target) {
  const candidates = [property.description, target?.description];
  return candidates.find((value) => typeof value === "string" && value.trim() !== "");
}

export function buildGeminiSettings(snapshot, source) {
  return walkGeminiSettings(snapshot).map(({ keyPath, property, target }) => {
    const mapped = target === null ? null : mapTarget(target);
    const description = descriptionOf(property, target);
    const { risks, secret } = classifyRisks(keyPath, description ?? "");
    return {
      id: keyPath,
      keyPath,
      valueType: mapped ? mapped.valueType : "unknown",
      allowedValues: mapped ? mapped.allowedValues : [],
      description: description ?? MISSING_DESCRIPTION,
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

export function renderGeminiCoverageReport({ snapshotInfo, tool, unresolved, collapsed, riskItems }) {
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

  return [
    "# Gemini CLI 覆盖报告",
    "",
    "本报告由 `scripts/merge-gemini-schema.mjs` 生成，请勿手动编辑。",
    "",
    "## 快照",
    "",
    `- 原始 URL：${snapshotInfo.url}`,
    `- 抓取日期：${snapshotInfo.retrievedOn}`,
    `- sha256：\`${snapshotInfo.sha256}\``,
    "- 托管方：Google 官方仓库 `google-gemini/gemini-cli` 托管；schema 不声明适用的 Gemini CLI 版本。",
    "",
    "## 收录与可编辑性",
    "",
    `- 顶层键：快照 ${snapshotInfo.propertyCount} 个，排除元键 \`$schema\` 后 ${snapshotInfo.propertyCount - SKIPPED_TOP_LEVEL_KEYS.length} 个。`,
    `- 设置项：按点号路径展开至最多 ${MAX_KEY_DEPTH} 段，共收录 ${settings.length} 项（含容器对象）。`,
    `- 可编辑键：${editable} 个。本任务没有任何键可编辑（所有设置项为 displayOnly，本工具没有已验证版本区间）。`,
    "- flags / env：本任务未收录，`flagsCoverage` 与 `envCoverage` 标注 `snapshotComplete: false`，待后续任务补充。",
    "",
    "## 按类型数量",
    "",
    table(["valueType", "数量"], typeRows),
    "",
    "## 深度截断与未展开清单",
    "",
    "- `depth`：超过 3 段深度上限的容器，仅收录容器本身（valueType = object），其子键未收录。",
    "- `map`：`additionalProperties` 为 schema 的映射类对象（含 `hooks`），子键由用户任意命名或由 schema 另行声明，只收录容器本身。",
    "",
    collapsed.length === 0
      ? "无。"
      : table(
          ["键", "原因"],
          collapsed.map(({ keyPath, reason }) => [escapeCell(keyPath), reason]),
        ),
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
    "标注规则：风险与秘密由键路径与 schema 描述的关键词匹配得出，宁可多标；协调者需复核。",
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
    "资源的说明文字见 `gemini-cli.json`。认证与凭据类资源为仅元数据：只标注存在性，不读取内容。",
    "",
    "## 产品迁移提示",
    "",
    "- 官方配置页与 GitHub README 均写明：`Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026.`（https://geminicli.com/docs/reference/configuration/；https://github.com/google-gemini/gemini-cli）。",
    "- 配置页同时写明：`Gemini CLI has not been optimized for Gemini 4 Argon`，并建议使用 Antigravity。",
    "- 影响：对上述用户，Gemini CLI 不再是官方推荐的使用途径，本定义的适用人群与本机版本无法据此确定。本任务未改变产品目标；所有设置保持 displayOnly，资源为 versionUnknown 或 unsupported（fail-closed），不做编辑。",
    "",
    "## 未核实项",
    "",
    "- 每个设置项的合并规则：文档未给出（未核实）。",
    "- `GEMINI_CLI_HOME` 是否重定位 `~/.gemini/settings.json`：配置页只说明其为用户级配置与存储的根目录，未逐条核实。",
    "- 凭据存放路径与覆盖变量：官方认证页未给出（未核实）。",
    "- 本定义适用的 Gemini CLI 版本区间：未核实，故所有资源与设置的版本字段为 null 或 versionUnknown。",
    "- 本机是否属于受迁移影响的用户：无法从官方文档判断。",
    "- `hooks` 下各事件键（`BeforeTool` 等）：因 `hooks` 为映射类对象未展开，其命令执行风险由容器 `hooks` 的标注承担。",
    "",
  ].join("\n");
}
