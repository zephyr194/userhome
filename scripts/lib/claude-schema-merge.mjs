import { createHash } from "node:crypto";

export const CLAUDE_CODE_TOOL_ID = "claude-code";
export const SCHEMA_DEFAULT_PREFIX = "schema 默认值：";
const NOTE_SEPARATOR = "；";
const INLINE_KEYS = new Set(["flags", "env"]);
const COVERAGE_KEYS = new Set(["flagsCoverage", "envCoverage"]);
const RISK_ORDER = ["executesCommand", "relaxesPermissions", "externalServer"];

const RISK_RULES = [
  {
    risk: "executesCommand",
    pattern:
      /\b(scripts?|executables?|helpers?|hooks?|statusLine|wrapper|command to run|commands? to run|bash commands?|shell commands?)\b/i,
  },
  {
    risk: "relaxesPermissions",
    pattern:
      /\b(bypass\w*|auto-?approv\w*|without (?:asking|confirmation|prompting)|skips? (?:the )?(?:\w+ )?(?:permissions?|prompts?|confirmations?|checks?|preflight)\w*)\b/i,
  },
  {
    risk: "externalServer",
    pattern:
      /\b(MCP|marketplaces?|plugins?|OAuth|SSH|gateway|endpoints?|remote control)\b/i,
  },
];


const SECRET_PATTERN = /apiKey|token|secret|password|credential/i;

const KEEP_UNKNOWN_REASON =
  "协调者决定（VC-1a）：保持 unknown。既有 Rust 断言钉住该类型（claude_snapshot_tests.rs），待人工复核后再提升";
const KEEP_UNKNOWN = {
  hooks: KEEP_UNKNOWN_REASON,
  fallbackModel: KEEP_UNKNOWN_REASON,
};

const MANUAL_RISKS = {
  awsCredentialExport: {
    risk: "executesCommand",
    reason: "人工核对：描述为输出凭据的命令，会由 Claude Code 执行",
  },
  processWrapper: {
    risk: "executesCommand",
    reason: "人工核对：描述为包裹后台进程的启动器命令",
  },
};


export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function readmeSha256(readmeText) {
  const match = /sha256：`([0-9a-f]{64})`/.exec(readmeText);
  return match ? match[1] : null;
}

export function serializeDefinitions(value) {
  return `${serialize(value, 0, "block", null)}\n`;
}

function childMode(ownerKey, key, value) {
  if (INLINE_KEYS.has(key)) {
    return Array.isArray(value) ? "items" : "line";
  }
  if (COVERAGE_KEYS.has(ownerKey) && key === "source") {
    return "line";
  }
  return "block";
}

function serialize(value, depth, mode, ownerKey) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (mode === "line") {
      return `[${value.map((item) => serialize(item, depth, "line", ownerKey)).join(", ")}]`;
    }
    const itemMode = mode === "items" ? "line" : "block";
    const items = value.map(
      (item) => `${inner}${serialize(item, depth + 1, itemMode, ownerKey)}`,
    );
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return "{}";
  }
  if (mode === "line") {
    const pairs = keys.map(
      (key) => `${JSON.stringify(key)}: ${serialize(value[key], depth, "line", key)}`,
    );
    return `{${pairs.join(", ")}}`;
  }
  const pairs = keys.map((key) => {
    const child = value[key];
    const childModeName = childMode(ownerKey, key, child);
    return `${inner}${JSON.stringify(key)}: ${serialize(child, depth + 1, childModeName, key)}`;
  });
  return `{\n${pairs.join(",\n")}\n${pad}}`;
}

export function mapSchemaType(property) {
  if (!property || typeof property !== "object") {
    return null;
  }
  if (property.$ref || property.anyOf || property.oneOf || property.allOf) {
    return null;
  }
  switch (property.type) {
    case "boolean":
      return { valueType: "boolean", allowedValues: [] };
    case "string": {
      if (property.enum === undefined) {
        return { valueType: "string", allowedValues: [] };
      }
      const values = property.enum;
      if (!Array.isArray(values) || values.length === 0) {
        return null;
      }
      if (!values.every((value) => typeof value === "string")) {
        return null;
      }
      return { valueType: "enum", allowedValues: [...values] };
    }
    case "array": {
      const items = property.items;
      if (items && items.type === "string" && items.enum === undefined && !items.$ref) {
        return { valueType: "stringArray", allowedValues: [] };
      }
      return null;
    }
    case "integer":
    case "number":
      return { valueType: "number", allowedValues: [] };
    case "object":
      return { valueType: "object", allowedValues: [] };
    default:
      return null;
  }
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function classifyRisks(setting, property) {
  const text = `${setting.keyPath} ${property.description ?? ""}`;
  const risks = [];
  const reasons = [];
  for (const rule of RISK_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      risks.push(rule.risk);
      reasons.push(`${rule.risk}：匹配“${match[0]}”`);
    }
  }
  const manual = MANUAL_RISKS[setting.keyPath];
  if (manual) {
    risks.push(manual.risk);
    reasons.push(`${manual.risk}：${manual.reason}`);
  }
  const secret = SECRET_PATTERN.test(setting.keyPath);
  if (secret) {
    reasons.push("秘密：键名含 key/token/secret/password/credential");
  }
  return { risks, secret, reasons };
}


function mergeRisks(existing, additions) {
  const merged = new Set([...existing, ...additions]);
  return RISK_ORDER.filter((risk) => merged.has(risk));
}

function appendSchemaDefault(setting, property) {
  const marker = `${SCHEMA_DEFAULT_PREFIX}${JSON.stringify(property.default)}`;
  if (setting.defaultNote.includes(marker)) {
    return false;
  }
  setting.defaultNote = setting.defaultNote
    ? `${setting.defaultNote}${NOTE_SEPARATOR}${marker}`
    : marker;
  return true;
}

export function mergeSchemaIntoDefinitions(definitions, snapshot) {
  const tool = definitions.tools.find((candidate) => candidate.id === CLAUDE_CODE_TOOL_ID);
  if (!tool) {
    throw new Error(`definitions 中缺少 ${CLAUDE_CODE_TOOL_ID}`);
  }
  const properties = snapshot.properties ?? {};
  const topLevelSettings = new Set();
  const report = {
    countsBefore: countValueTypes(tool.settings),
    completed: [],
    defaults: [],
    conflicts: [],
    unresolvedComplex: [],
    excluded: [],
    schemaOnly: [],
  };

  for (const setting of tool.settings) {
    if (setting.keyPath.includes(".")) {
      continue;
    }
    topLevelSettings.add(setting.keyPath);
    const property = properties[setting.keyPath];
    if (!property) {
      continue;
    }
    const mapped = mapSchemaType(property);
    if (setting.valueType === "unknown") {
      if (KEEP_UNKNOWN[setting.keyPath]) {
        report.excluded.push({
          keyPath: setting.keyPath,
          schemaType: mapped ? mapped.valueType : "complex",
          reason: KEEP_UNKNOWN[setting.keyPath],
        });
      } else if (mapped) {
        setting.valueType = mapped.valueType;
        setting.allowedValues = mapped.allowedValues;
        const { risks, secret, reasons } = classifyRisks(setting, property);
        setting.risks = mergeRisks(setting.risks, risks);
        if (secret) {
          setting.secret = true;
        }
        report.completed.push({
          keyPath: setting.keyPath,
          valueType: mapped.valueType,
          allowedValues: mapped.allowedValues,
          risks: setting.risks,
          secret: setting.secret,
          reasons,
        });
      } else {
        report.unresolvedComplex.push(setting.keyPath);
      }
    } else if (
      mapped &&
      (mapped.valueType !== setting.valueType ||
        !sameList(mapped.allowedValues, setting.allowedValues))
    ) {
      report.conflicts.push({
        keyPath: setting.keyPath,
        local: { valueType: setting.valueType, allowedValues: setting.allowedValues },
        schema: { valueType: mapped.valueType, allowedValues: mapped.allowedValues },
      });
    }
    if (property.default !== undefined) {
      appendSchemaDefault(setting, property);
      report.defaults.push({ keyPath: setting.keyPath, default: property.default });
    }
    if (!setting.description && typeof property.description === "string") {
      setting.description = property.description;
    }
  }

  for (const key of Object.keys(properties)) {
    if (!topLevelSettings.has(key)) {
      report.schemaOnly.push(key);
    }
  }
  report.countsAfter = countValueTypes(tool.settings);
  report.totalSettings = tool.settings.length;
  return { definitions, report };
}

function countValueTypes(settings) {
  const counts = {};
  for (const setting of settings) {
    counts[setting.valueType] = (counts[setting.valueType] ?? 0) + 1;
  }
  return counts;
}

export function editableCount(definitions) {
  const tool = definitions.tools.find((candidate) => candidate.id === CLAUDE_CODE_TOOL_ID);
  return tool.settings.filter((setting) => setting.coverage === "editable").length;
}

export const EDITABLE_SECTION_TITLE = "## 可编辑键（VC-1b）";
const EDITABLE_VALUE_TYPES = new Set(["boolean", "enum", "string"]);

function validateEditablePolicy(policy, definitions) {
  const tool = definitions.tools.find((candidate) => candidate.id === CLAUDE_CODE_TOOL_ID);
  const byKey = new Map(tool.settings.map((setting) => [setting.keyPath, setting]));
  if (!/^\d+\.\d+\.\d+$/.test(policy.verifiedVersion)) {
    throw new Error(`verifiedVersion 不合法：${policy.verifiedVersion}`);
  }
  const keys = new Set();
  for (const keyPath of policy.keys) {
    if (keys.has(keyPath)) {
      throw new Error(`清单重复键：${keyPath}`);
    }
    keys.add(keyPath);
    const setting = byKey.get(keyPath);
    if (!setting) {
      throw new Error(`清单键不存在于定义：${keyPath}`);
    }
    if (!EDITABLE_VALUE_TYPES.has(setting.valueType)) {
      throw new Error(`清单键类型不允许可编辑：${keyPath}（${setting.valueType}）`);
    }
    if (setting.risks.length > 0) {
      throw new Error(`清单键带风险标注，不允许可编辑：${keyPath}`);
    }
    if (setting.secret) {
      throw new Error(`清单键为秘密键，不允许可编辑：${keyPath}`);
    }
  }
  for (const item of policy.excluded) {
    if (!byKey.has(item.keyPath)) {
      throw new Error(`排除键不存在于定义：${item.keyPath}`);
    }
    if (keys.has(item.keyPath)) {
      throw new Error(`键同时出现在清单与排除清单：${item.keyPath}`);
    }
    if (!item.reason) {
      throw new Error(`排除键缺少理由：${item.keyPath}`);
    }
  }
}

export function applyEditablePolicy(definitions, policy) {
  validateEditablePolicy(policy, definitions);
  const tool = definitions.tools.find((candidate) => candidate.id === CLAUDE_CODE_TOOL_ID);
  const editable = new Set(policy.keys);
  for (const setting of tool.settings) {
    if (editable.has(setting.keyPath)) {
      setting.coverage = "editable";
      setting.versions = { min: policy.verifiedVersion, max: policy.verifiedVersion };
    } else {
      setting.coverage = "displayOnly";
      setting.versions = null;
    }
  }
  return definitions;
}

function renderEditableSection(policy) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  push(EDITABLE_SECTION_TITLE);
  push();
  push("由 `sources/claude-editable-keys.json` 决定，脚本每次运行都会按清单重写本节。");
  push();
  push(`- 决定日期：${policy.decidedOn}（用户确认 G-V1 稳妥集）`);
  push(`- 已验证版本：${policy.verifiedVersion}（versions 的 min 与 max 相同，即单一精确版本）`);
  push(`- 可编辑键数：${policy.keys.length}；清单外的键保持 displayOnly，versions 为 null`);
  push(`- 版本依据：${policy.basis}`);
  push(`- 未做真实写入验证：本批未在 ${policy.verifiedVersion} 上对任何键执行写入并核对结果。`);
  push();
  push("### 提升清单");
  push();
  for (const keyPath of policy.keys) {
    push(`- \`${keyPath}\``);
  }
  push();
  push("### 排除清单（保持 displayOnly）");
  push();
  for (const item of policy.excluded) {
    push(`- \`${item.keyPath}\`：${item.reason}`);
  }
  push();
  return `${lines.join("\n")}\n`;
}

export function replaceEditableSection(reportText, policy) {
  const index = reportText.indexOf(EDITABLE_SECTION_TITLE);
  const base = index === -1 ? reportText : reportText.slice(0, index);
  return `${base}${renderEditableSection(policy)}`;
}

export function renderCoverageReport({ report, snapshotInfo, localOnlyNested }) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  push("# Claude Code 官方 schema 覆盖报告");
  push();
  push("本文件由 `scripts/merge-claude-schema.mjs` 生成，勿手动编辑。");
  push();
  push("## 快照");
  push();
  push(`- 原始 URL：${snapshotInfo.url}`);
  push(`- 抓取日期：${snapshotInfo.retrievedOn}`);
  push(`- sha256：\`${snapshotInfo.sha256}\``);
  push("- 托管方：第三方（SchemaStore）。官方文档 `$schema` 指向该文件；schema 不声明适用的 Claude Code 版本。");
  push();
  push("## 合并结果");
  push();
  push(`- 设置项总数：${report.totalSettings}（keyPath 与 id 未变）`);
  push(`- 补全类型的键：${report.completed.length}`);
  push(`- 排除（schema 有类型但保持 unknown）：${report.excluded.length}`);
  push(`- 冲突（保留本地值）：${report.conflicts.length}`);
  push(`- 复杂结构（保持 unknown）：${report.unresolvedComplex.length}`);
  push("- 合并不改变 coverage 与 versions；可编辑键由清单决定，见文末“可编辑键”一节");
  push();
  push("### 按类型的数量");
  push();
  push("| valueType | 合并前 | 合并后 |");
  push("| --- | ---: | ---: |");
  const types = [
    "string",
    "boolean",
    "number",
    "stringArray",
    "object",
    "enum",
    "unknown",
  ];
  for (const type of types) {
    push(`| ${type} | ${report.countsBefore[type] ?? 0} | ${report.countsAfter[type] ?? 0} |`);
  }
  push();
  push("## 补全清单");
  push();
  push("| keyPath | valueType | allowedValues |");
  push("| --- | --- | --- |");
  for (const item of report.completed) {
    const allowed = item.allowedValues.length ? item.allowedValues.join(", ") : "—";
    push(`| \`${item.keyPath}\` | ${item.valueType} | ${allowed} |`);
  }
  push();
  push("## schema 默认值追加");
  push();
  for (const item of report.defaults) {
    push(`- \`${item.keyPath}\`：${SCHEMA_DEFAULT_PREFIX}${JSON.stringify(item.default)}`);
  }
  push();
  push("## 冲突（本地非 unknown 且与 schema 不一致，保留本地值）");
  push();
  if (report.conflicts.length === 0) {
    push("无。");
  }
  for (const item of report.conflicts) {
    push(
      `- \`${item.keyPath}\`：本地 ${describeType(item.local)}；schema ${describeType(item.schema)}`,
    );
  }
  push();
  push("## 排除（schema 有类型，但按协调者决定保持 unknown）");
  push();
  for (const item of report.excluded) {
    push(`- \`${item.keyPath}\`：schema 类型 ${item.schemaType}；${item.reason}`);
  }
  push();
  push("## 未补全（schema 为复杂结构，保持 unknown）");
  push();
  for (const keyPath of report.unresolvedComplex) {
    push(`- \`${keyPath}\``);
  }
  push();
  push("## schema 独有键");
  push();
  for (const key of report.schemaOnly) {
    push(`- \`${key}\``);
  }
  push();
  push("## 本地独有键（未在 schema 顶层出现）");
  push();
  push(`嵌套键路径与 schema 未收录的键共 ${localOnlyNested.length} 个，逐项如下：`);
  push();
  for (const keyPath of localOnlyNested) {
    push(`- \`${keyPath}\``);
  }
  push();
  push("## 风险与秘密标注（待协调者复核）");
  push();
  push("以下标注仅针对本次补全的键，依据为键名与 schema 描述的关键词匹配，宁可多标。");
  push();
  for (const item of report.completed) {
    if (item.risks.length === 0 && !item.secret) {
      continue;
    }
    const risks = item.risks.length ? item.risks.join(", ") : "无";
    push(`- \`${item.keyPath}\`：风险 ${risks}；secret ${item.secret ? "是" : "否"}`);
    for (const reason of item.reasons) {
      push(`  - ${reason}`);
    }
  }
  push();
  return `${lines.join("\n")}\n`;
}

function describeType(side) {
  const allowed = side.allowedValues?.length ? `（${side.allowedValues.join(", ")}）` : "";
  return `${side.valueType}${allowed}`;
}
