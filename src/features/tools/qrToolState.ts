import type { SelectOption } from "../../components/ui";
import { translate, type Locale, type MessageKey } from "../../i18n";
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

export function levelOptions(
  locale: Locale = "zh-CN",
): readonly SelectOption<QrErrorCorrection>[] {
  return (["L", "M", "Q", "H"] as const).map((value) => ({
    value,
    label: translate(locale, `tools.qr.level.${value}`),
  }));
}

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

export function iconRulesText(locale: Locale = "zh-CN"): string {
  return translate(locale, "tools.qr.iconRules");
}

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
  locale: Locale = "zh-CN",
): string | undefined {
  if (iconId === undefined || level === "H") return undefined;
  return translate(locale, "tools.qr.iconLevelNotice");
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
  locale: Locale = "zh-CN",
): string | undefined {
  if (text.length === 0) return undefined;
  const max = QR_MAX_BYTES[level];
  if (utf8ByteLength(text) > max) {
    return translate(locale, "tools.qr.inputOverLimit", { level, max });
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
  | { status: "written"; target: string; message: string; warning?: string }
  | { status: "failed"; message: string; warning?: string };

export function grantNotRevokedMessage(locale: Locale = "zh-CN"): string {
  return translate(locale, "tools.qr.grantNotRevoked");
}

export function discardFailedMessage(locale: Locale = "zh-CN"): string {
  return translate(locale, "tools.qr.discardFailed");
}

export function describePrepared(
  prepared: PreparedQrExport,
  locale: Locale = "zh-CN",
): {
  title: string;
  notes: string[];
} {
  if (prepared.kind === "REPLACE") {
    return {
      title: translate(locale, "tools.qr.prepared.replaceTitle", {
        target: prepared.target,
      }),
      notes: [
        translate(locale, "tools.qr.prepared.replaceBackup"),
        translate(locale, "tools.qr.prepared.replaceCheckPath"),
      ],
    };
  }
  return {
    title: translate(locale, "tools.qr.prepared.createTitle", {
      target: prepared.target,
    }),
    notes: [translate(locale, "tools.qr.prepared.createNote")],
  };
}

const FILE_STATE_KEYS: Record<QrFileState, MessageKey> = {
  WRITTEN: "tools.qr.fileState.WRITTEN",
  UNCHANGED: "tools.qr.fileState.UNCHANGED",
  RESTORED: "tools.qr.fileState.RESTORED",
  RESTORE_FAILED: "tools.qr.fileState.RESTORE_FAILED",
  CREATED_REMOVED: "tools.qr.fileState.CREATED_REMOVED",
  CREATED_REMOVE_FAILED: "tools.qr.fileState.CREATED_REMOVE_FAILED",
  UNKNOWN: "tools.qr.fileState.UNKNOWN",
};

export function exportOutcomeView(
  target: string,
  outcome: QrExportOutcome,
  locale: Locale = "zh-CN",
): QrExportView {
  const warning = outcome.grantReleaseError
    ? { warning: grantNotRevokedMessage(locale) }
    : {};
  if (outcome.status === "FAILED") {
    return {
      status: "failed",
      message: translate(locale, FILE_STATE_KEYS[outcome.fileState]),
      ...warning,
    };
  }
  return {
    status: "written",
    target,
    message: translate(
      locale,
      outcome.recoveryPoint === "BACKUP"
        ? "tools.qr.outcome.backedUp"
        : "tools.qr.outcome.written",
    ),
    ...warning,
  };
}

/** The prepared export a view still holds; it must be discarded when the view is dropped. */
export function discardTarget(view: QrExportView): PreparedQrExport | undefined {
  return view.status === "awaiting" ? view.prepared : undefined;
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
