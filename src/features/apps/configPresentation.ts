import type {
  ConfigAccessMode,
  ConfigSensitivity,
  ManagedAppSummary,
  ManagedConfigDocumentPresentation,
} from "../../ipc/catalog";
import type {
  ConfigDocumentState,
  ConfigNextAction,
  ConfigWritePolicy,
} from "../../ipc/config";
import type { StatusBadgeProps } from "../../components/ui";

interface StatePresentation {
  label: string;
  description: string;
  tone: StatusBadgeProps["tone"];
}

export const CONFIG_STATE_PRESENTATION: Record<
  ConfigDocumentState,
  StatePresentation
> = {
  MISSING: {
    label: "不存在",
    description: "此路径当前没有配置文件。",
    tone: "neutral",
  },
  READY: {
    label: "可读取",
    description: "内容已通过边界检查，可按 catalog 能力安全展示。",
    tone: "success",
  },
  INVALID: {
    label: "内容无效",
    description: "内容未通过格式解析或校验，不会显示为成功文档。",
    tone: "danger",
  },
  REDACTED: {
    label: "已屏蔽",
    description: "敏感内容已脱敏，或按策略仅返回元数据。",
    tone: "warning",
  },
  TOO_LARGE: {
    label: "超过大小限制",
    description: "文件超过 catalog 声明的读取上限，内容未被读取。",
    tone: "warning",
  },
  PERMISSION_DENIED: {
    label: "权限不足",
    description: "当前进程没有读取权限，未尝试绕过系统权限。",
    tone: "danger",
  },
  UNSAFE_SYMLINK: {
    label: "链接不安全",
    description: "符号链接超出授权根或不满足安全路径策略。",
    tone: "danger",
  },
  UNSUPPORTED_FORMAT: {
    label: "格式不支持",
    description: "catalog 未提供可安全处理此格式的能力。",
    tone: "warning",
  },
  IO_ERROR: {
    label: "读取失败",
    description: "发生暂时性 I/O 错误，可以安全重试。",
    tone: "danger",
  },
};

export const CONFIG_ACTION_LABELS: Record<ConfigNextAction, string> = {
  NONE: "无需操作",
  CREATE_FILE: "在应用中创建配置文件后重试",
  FIX_CONTENT: "使用对应应用修复配置内容",
  VIEW_REDACTED: "查看已屏蔽的安全视图",
  REDUCE_SIZE: "缩小文件至 catalog 限制以内",
  REVIEW_PERMISSIONS: "检查文件权限后重试",
  REPAIR_SYMLINK: "修复符号链接，使其保持在授权根内",
  UPDATE_CATALOG: "等待或更新 catalog 能力定义",
  RETRY: "重新读取此配置",
};

export const ACCESS_MODE_PRESENTATION: Record<
  ConfigAccessMode,
  StatePresentation
> = {
  READ_WRITE: {
    label: "可写",
    description: "仅可通过已批准编辑器、校验、预览与确认流程修改。",
    tone: "success",
  },
  READ_ONLY: {
    label: "只读",
    description: "可以查看安全内容，但不提供修改、备份或恢复操作。",
    tone: "neutral",
  },
  METADATA_ONLY: {
    label: "仅元数据",
    description: "只显示路径、状态和有界文件元数据，不读取内容。",
    tone: "warning",
  },
  EXCLUDED: {
    label: "已排除",
    description: "此文档被安全策略排除，不读取内容，也不提供操作。",
    tone: "warning",
  },
};

export const SENSITIVITY_PRESENTATION: Record<
  ConfigSensitivity,
  { label: string; tone: StatusBadgeProps["tone"] }
> = {
  STANDARD: { label: "标准", tone: "neutral" },
  SENSITIVE: { label: "敏感", tone: "warning" },
  SECRET: { label: "秘密", tone: "danger" },
};

export const WRITE_POLICY_LABELS: Record<ConfigWritePolicy, string> = {
  MANAGED_BLOCK: "受管区块",
  READ_ONLY: "只读",
  STRUCTURED_AND_RAW: "结构化与原始写入",
  RAW_VALIDATED: "校验后原始写入",
};

export type ConfigDocumentActionMode =
  | "WRITE"
  | "READ_ONLY"
  | "METADATA_ONLY"
  | "EXCLUDED"
  | "APPLICATION_READ_ONLY"
  | "FORMAT_MISMATCH"
  | "UNKNOWN_EDITOR"
  | "VARIANT_UNAVAILABLE"
  | "ALTERNATE_VARIANT"
  | "MISSING_HASH";

export const CONFIG_DOCUMENT_ACTION_PRESENTATION: Record<
  Exclude<ConfigDocumentActionMode, "WRITE">,
  { description: string; kind: "empty" | "partial" }
> = {
  READ_ONLY: {
    description:
      "此文档为只读视图；catalog 与文档策略均未授权写入。",
    kind: "empty",
  },
  METADATA_ONLY: {
    description: ACCESS_MODE_PRESENTATION.METADATA_ONLY.description,
    kind: "partial",
  },
  EXCLUDED: {
    description: ACCESS_MODE_PRESENTATION.EXCLUDED.description,
    kind: "partial",
  },
  APPLICATION_READ_ONLY: {
    description: "应用 catalog 未授予 WRITE_CONFIG，所有修改操作已禁用。",
    kind: "empty",
  },
  FORMAT_MISMATCH: {
    description:
      "读取结果的格式与 catalog 声明不一致；内容和所有修改操作已隐藏。",
    kind: "partial",
  },
  UNKNOWN_EDITOR: {
    description:
      "editorKey 没有对应的安全编辑能力；所有修改操作已禁用。",
    kind: "empty",
  },
  VARIANT_UNAVAILABLE: {
    description:
      "尚未确认路径变体优先级；为避免写入错误位置，修改操作暂不可用。",
    kind: "empty",
  },
  ALTERNATE_VARIANT: {
    description:
      "当前路径变体不是优先级解析结果；切回标记为“当前优先”的变体后才能编辑。",
    kind: "empty",
  },
  MISSING_HASH: {
    description: "当前文档缺少可写内容哈希；所有修改操作已禁用。",
    kind: "empty",
  },
};

export function resolveConfigDocumentActionMode({
  accessMode,
  applicationCanWrite,
  contentHash,
  editorAvailable,
  formatMatches,
  selectedVariant,
  writePolicy,
}: {
  accessMode: ConfigAccessMode;
  applicationCanWrite: boolean;
  contentHash?: string;
  editorAvailable: boolean;
  formatMatches: boolean;
  selectedVariant?: boolean;
  writePolicy: ConfigWritePolicy;
}): ConfigDocumentActionMode {
  if (accessMode === "METADATA_ONLY") return "METADATA_ONLY";
  if (accessMode === "EXCLUDED") return "EXCLUDED";
  if (!formatMatches) return "FORMAT_MISMATCH";
  if (accessMode === "READ_ONLY" || writePolicy === "READ_ONLY") {
    return "READ_ONLY";
  }
  if (!applicationCanWrite) return "APPLICATION_READ_ONLY";
  if (!editorAvailable) return "UNKNOWN_EDITOR";
  if (selectedVariant === undefined) return "VARIANT_UNAVAILABLE";
  if (!selectedVariant) return "ALTERNATE_VARIANT";
  if (!contentHash) return "MISSING_HASH";
  return "WRITE";
}

export function getConfigPresentation(
  application: ManagedAppSummary,
  configId: string,
): ManagedConfigDocumentPresentation | undefined {
  return application.presentation.configDocuments.find(
    (document) => document.configId === configId,
  );
}
