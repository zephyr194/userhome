export declare const CODEX_CLI_TOOL_ID: "codex-cli";
export declare const SCHEMA_FILE_NAME: string;
export declare const SCHEMA_DEFAULT_PREFIX: string;
export declare const SCHEMA_NO_DEFAULT: string;
export declare const MERGE_RULE_UNVERIFIED: string;
export declare const MISSING_DESCRIPTION: string;

export type SchemaNode = Record<string, unknown>;

export interface CodexSnapshot {
  properties?: Record<string, SchemaNode>;
  definitions?: Record<string, SchemaNode>;
}

export interface SchemaSource {
  url: string;
  retrievedOn: string;
  documentedVersion: string;
}

export interface MappedType {
  valueType: "string" | "boolean" | "number" | "enum" | "stringArray" | "object";
  allowedValues: string[];
}

export interface RiskClassification {
  risks: ("executesCommand" | "relaxesPermissions" | "externalServer")[];
  secret: boolean;
}

export interface CodexSetting {
  id: string;
  keyPath: string;
  valueType: string;
  allowedValues: string[];
  description: string;
  defaultNote: string;
  mergeRule: string;
  risks: string[];
  secret: boolean;
  coverage: string;
  versions: null;
  source: SchemaSource;
}

export interface CodexToolDefinition {
  id: string;
  resources: { id: string; layer: string; format: string; location: string; description: string; coverage: string; source: SchemaSource }[];
  settings: CodexSetting[];
  [key: string]: unknown;
}

export declare function sha256Hex(text: string): string;
export declare function readmeSha256(readmeText: string): string | null;
export declare function mapSchemaProperty(
  property: SchemaNode,
  definitions: Record<string, SchemaNode>,
): MappedType | null;
export declare function unresolvedReason(
  property: SchemaNode,
  definitions: Record<string, SchemaNode>,
): string;
export declare function classifyRisks(keyPath: string, description: string): RiskClassification;
export declare function buildCodexSettings(
  snapshot: CodexSnapshot,
  source: SchemaSource,
): CodexSetting[];
export declare function renderCoverageReport(input: {
  snapshotInfo: { url: string; retrievedOn: string; sha256: string; propertyCount: number };
  tool: CodexToolDefinition;
  unresolved: { keyPath: string; reason: string }[];
  riskItems: { keyPath: string; risks: string[]; secret: boolean }[];
}): string;
