import type { SelectOption } from "../../components/ui";
import type {
  PreparedQrExport,
  QrErrorCorrection,
  QrExportOutcome,
  QrFileState,
  QrIconSummary,
  QrPixelSize,
  QrPreview,
} from "../../ipc/qr";

export type SizeChoice = "256" | "512" | "1024";

const SIZE_PIXELS: Record<SizeChoice, QrPixelSize> = {
  "256": 256,
  "512": 512,
  "1024": 1024,
};

// Mirrors the backend limits in src-tauri/src/qr/encode.rs: the level's
// byte-mode capacity, capped at 2048 bytes.
export const QR_MAX_BYTES: Record<QrErrorCorrection, number> = {
  L: 2048,
  M: 2048,
  Q: 1663,
  H: 1273,
};

export const LEVEL_OPTIONS: readonly SelectOption<QrErrorCorrection>[] = [
  { value: "L", label: "L · 约 7%" },
  { value: "M", label: "M · 约 15%" },
  { value: "Q", label: "Q · 约 25%" },
  { value: "H", label: "H · 约 30%" },
];

export const SIZE_OPTIONS: readonly SelectOption<SizeChoice>[] = [
  { value: "256", label: "256 px" },
  { value: "512", label: "512 px" },
  { value: "1024", label: "1024 px" },
];

export function toPixelSize(choice: SizeChoice): QrPixelSize {
  return SIZE_PIXELS[choice];
}

export interface QrSnapshot {
  text: string;
  level: QrErrorCorrection;
  size: SizeChoice;
  iconId?: string;
}

export const ICON_RULES_TEXT =
  "图标居中并加白色底衬，外接框不超过符号宽度的 15%。加图标时纠错固定为 H。无法可靠放置时会拒绝导出，不生成损坏图片。";

/** A centred icon always uses level H, whatever level the user picked. */
export function effectiveLevel(
  level: QrErrorCorrection,
  iconId: string | undefined,
): QrErrorCorrection {
  return iconId === undefined ? level : "H";
}

export function iconLevelNotice(
  level: QrErrorCorrection,
  iconId: string | undefined,
): string | undefined {
  if (iconId === undefined || level === "H") return undefined;
  return "加中心图标时纠错等级已自动提升为 H。";
}

export function describeIcon(icon: QrIconSummary): string {
  return `${icon.format} · ${icon.width} × ${icon.height} px`;
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** A message when the text cannot be encoded at this level, else undefined. */
export function inputProblem(
  text: string,
  level: QrErrorCorrection,
): string | undefined {
  if (text.length === 0) return undefined;
  const max = QR_MAX_BYTES[level];
  if (utf8ByteLength(text) > max) {
    return `输入超过 ${level} 级纠错的 ${max} 字节上限，未生成。请缩短内容或选择更低纠错等级。`;
  }
  return undefined;
}

export function snapshotsEqual(a: QrSnapshot, b: QrSnapshot): boolean {
  return (
    a.text === b.text &&
    a.level === b.level &&
    a.size === b.size &&
    a.iconId === b.iconId
  );
}

export type QrPreviewView =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; snapshot: QrSnapshot; preview: QrPreview }
  | { status: "error"; message: string };

export type QrExportView =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "awaiting"; snapshot: QrSnapshot; prepared: PreparedQrExport }
  | { status: "writing"; snapshot: QrSnapshot; prepared: PreparedQrExport }
  | { status: "cancelled" }
  | { status: "written"; target: string; message: string }
  | { status: "failed"; message: string };

export function describePrepared(prepared: PreparedQrExport): {
  title: string;
  notes: string[];
} {
  if (prepared.kind === "REPLACE") {
    return {
      title: `将覆盖已有文件：${prepared.target}`,
      notes: [
        "覆盖前会把原文件保存为备份；写入后会回读校验。",
        "确认前请核对文件路径。",
      ],
    };
  }
  return {
    title: `将创建新文件：${prepared.target}`,
    notes: ["新文件没有恢复点；写入后会回读校验。"],
  };
}

const FILE_STATE_MESSAGES: Record<QrFileState, string> = {
  WRITTEN: "文件已写入。",
  UNCHANGED: "导出失败，文件未改动。",
  RESTORED: "写入校验失败，已恢复原内容并校验。文件未保留新二维码。",
  RESTORE_FAILED:
    "写入校验失败，且无法确认已恢复原内容。文件可能包含新内容；备份仍保留原内容。",
  CREATED_REMOVED: "新文件校验失败，已删除。未生成文件。",
  CREATED_REMOVE_FAILED:
    "新文件校验失败且无法删除，文件可能仍存在。请手动检查。",
  UNKNOWN: "无法确定文件的最终状态，请手动检查该文件。",
};

export function exportOutcomeView(
  target: string,
  outcome: QrExportOutcome,
): QrExportView {
  if (outcome.status === "FAILED") {
    return { status: "failed", message: FILE_STATE_MESSAGES[outcome.fileState] };
  }
  return {
    status: "written",
    target,
    message:
      outcome.recoveryPoint === "BACKUP"
        ? "覆盖完成，原文件已备份，并已回读校验。"
        : "导出完成，已写入并回读校验。",
  };
}

/** Export is offered only for the snapshot the user is looking at. */
export function canStartExport(
  preview: QrPreviewView,
  exportView: QrExportView,
): boolean {
  return (
    preview.status === "ready" &&
    (exportView.status === "idle" ||
      exportView.status === "cancelled" ||
      exportView.status === "written" ||
      exportView.status === "failed")
  );
}

export function isExportBusy(exportView: QrExportView): boolean {
  return (
    exportView.status === "preparing" ||
    exportView.status === "awaiting" ||
    exportView.status === "writing"
  );
}
