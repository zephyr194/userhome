export declare const GEMINI_CLI_TOOL_ID: "gemini-cli";
export declare const SCHEMA_FILE_NAME: string;
export declare const SCHEMA_DEFAULT_PREFIX: string;
export declare const SCHEMA_NO_DEFAULT: string;
export declare const MERGE_RULE_UNVERIFIED: string;
export declare const MISSING_DESCRIPTION: string;
export declare const MAX_KEY_DEPTH: number;
export declare const SKIPPED_TOP_LEVEL_KEYS: string[];

export type SchemaNode = Record<string, unknown>;

export interface GeminiSnapshot {
  properties?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
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

export interface WalkedSetting {
  keyPath: string;
  property: SchemaNode;
  target: SchemaNode | null;
  collapsed: "depth" | "map" | null;
}

export interface GeminiSetting {
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

export interface GeminiToolDefinition {
  id: string;
  resources: {
    id: string;
    layer: string;
    format: string;
    location: string;
    description: string;
    coverage: string;
    source: SchemaSource;
  }[];
  settings: GeminiSetting[];
  [key: string]: unknown;
}

export declare function sha256Hex(text: string): string;
export declare function readmeSha256(readmeText: string): string | null;
export declare function resolveNode(
  node: SchemaNode,
  definitions: Record<string, SchemaNode>,
  depth?: number,
): SchemaNode | null;
export declare function mapSchemaProperty(
  property: SchemaNode,
  definitions: Record<string, SchemaNode>,
): MappedType | null;
export declare function unresolvedReason(
  property: SchemaNode,
  definitions: Record<string, SchemaNode>,
): string;
export declare function classifyRisks(keyPath: string, description: string): RiskClassification;
export declare function walkGeminiSettings(snapshot: GeminiSnapshot): WalkedSetting[];
export declare function buildGeminiSettings(
  snapshot: GeminiSnapshot,
  source: SchemaSource,
): GeminiSetting[];
export declare function renderGeminiCoverageReport(input: {
  snapshotInfo: { url: string; retrievedOn: string; sha256: string; propertyCount: number };
  tool: GeminiToolDefinition;
  unresolved: { keyPath: string; reason: string }[];
  collapsed: { keyPath: string; reason: string }[];
  riskItems: { keyPath: string; risks: string[]; secret: boolean }[];
}): string;
