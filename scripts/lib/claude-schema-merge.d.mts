export declare const CLAUDE_CODE_TOOL_ID: string;
export declare const SCHEMA_DEFAULT_PREFIX: string;

export interface SchemaSnapshot {
  properties?: Record<string, SchemaProperty>;
}

export interface SchemaProperty {
  type?: string | string[];
  enum?: unknown[];
  items?: SchemaProperty;
  description?: string;
  default?: unknown;
  $ref?: string;
  anyOf?: unknown[];
  oneOf?: unknown[];
  allOf?: unknown[];
}

export interface SettingDefinition {
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
  versions: unknown;
  source: unknown;
}

export interface ToolDefinition {
  id: string;
  settings: SettingDefinition[];
  [key: string]: unknown;
}

export interface Definitions {
  schemaVersion: number;
  tools: ToolDefinition[];
}

export interface TypeSide {
  valueType: string;
  allowedValues: string[];
}

export interface MergeReport {
  countsBefore: Record<string, number>;
  countsAfter: Record<string, number>;
  totalSettings: number;
  completed: {
    keyPath: string;
    valueType: string;
    allowedValues: string[];
    risks: string[];
    secret: boolean;
    reasons: string[];
  }[];
  defaults: { keyPath: string; default: unknown }[];
  conflicts: { keyPath: string; local: TypeSide; schema: TypeSide }[];
  unresolvedComplex: string[];
  schemaOnly: string[];
  localOnly: string[];
}

export declare function sha256Hex(text: string): string;
export declare function readmeSha256(readmeText: string): string | null;
export declare function serializeDefinitions(value: unknown): string;
export declare function mapSchemaType(property: SchemaProperty): TypeSide | null;
export declare function mergeSchemaIntoDefinitions(
  definitions: Definitions,
  snapshot: SchemaSnapshot,
): { definitions: Definitions; report: MergeReport };
export declare function editableCount(definitions: Definitions): number;
export declare function renderCoverageReport(input: {
  report: MergeReport;
  snapshotInfo: { url: string; retrievedOn: string; sha256: string };
  localOnlyNested: string[];
}): string;
