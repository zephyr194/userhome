type SchemaNode = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaNode {
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

export function schemaIssues(
  value: unknown,
  node: SchemaNode,
  root: SchemaNode,
  path: string,
): string[] {
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/$defs/", "");
    const target = (root.$defs as Record<string, SchemaNode>)[name];
    return schemaIssues(value, target, root, path);
  }
  if (Array.isArray(node.anyOf)) {
    const matched = (node.anyOf as SchemaNode[]).some(
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
        issues.push(...schemaIssues(item, node.items as SchemaNode, root, `${path}[${index}]`)),
      );
    }
  }
  if (isRecord(value)) {
    const properties = (node.properties ?? {}) as Record<string, SchemaNode>;
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
