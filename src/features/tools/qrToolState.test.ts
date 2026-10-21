import { describe, expect, it } from "vitest";
import {
  LEVEL_OPTIONS,
  QR_MAX_BYTES,
  SIZE_OPTIONS,
  canStartExport,
  describePrepared,
  exportOutcomeView,
  inputProblem,
  isExportBusy,
  snapshotsEqual,
  toPixelSize,
  utf8ByteLength,
  type QrExportView,
  type QrPreviewView,
  type QrSnapshot,
} from "./qrToolState";
import type { PreparedQrExport, QrExportOutcome } from "../../ipc/qr";

const SNAPSHOT: QrSnapshot = { text: "https://example.com", level: "M", size: "512" };
const READY: QrPreviewView = {
  status: "ready",
  snapshot: SNAPSHOT,
  preview: {
    pngBase64: "iVBORw0KGgo",
    sha256: "a".repeat(64),
    imagePx: 512,
    modulePx: 6,
    moduleCount: 77,
  },
};
const IDLE_EXPORT: QrExportView = { status: "idle" };

describe("QR input limits", () => {
  it("mirrors the backend byte limits per level", () => {
    expect(QR_MAX_BYTES).toEqual({ L: 2048, M: 2048, Q: 1663, H: 1273 });
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("中")).toBe(3);
    expect(utf8ByteLength("🙂")).toBe(4);
  });

  it("allows exactly the limit and refuses one more byte", () => {
    expect(inputProblem("a".repeat(2048), "M")).toBeUndefined();
    expect(inputProblem("a".repeat(2049), "M")).toContain("2048");
    expect(inputProblem("a".repeat(1273), "H")).toBeUndefined();
    expect(inputProblem("a".repeat(1274), "H")).toContain("1273");
  });

  it("applies the byte limit to multibyte text", () => {
    expect(inputProblem("中".repeat(682), "M")).toBeUndefined();
    expect(inputProblem("中".repeat(683), "M")).toContain("2048");
  });

  it("shows nothing for empty input, which is simply idle", () => {
    expect(inputProblem("", "L")).toBeUndefined();
  });
});

describe("QR options", () => {
  it("offers the four levels and three sizes with string values", () => {
    expect(LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      "L",
      "M",
      "Q",
      "H",
    ]);
    expect(SIZE_OPTIONS.map((option) => option.value)).toEqual([
      "256",
      "512",
      "1024",
    ]);
  });

  it("maps size choices to pixel sizes", () => {
    expect(toPixelSize("256")).toBe(256);
    expect(toPixelSize("512")).toBe(512);
    expect(toPixelSize("1024")).toBe(1024);
  });

  it("compares snapshots by text, level and size", () => {
    expect(snapshotsEqual(SNAPSHOT, { ...SNAPSHOT })).toBe(true);
    expect(snapshotsEqual(SNAPSHOT, { ...SNAPSHOT, size: "1024" })).toBe(false);
    expect(snapshotsEqual(SNAPSHOT, { ...SNAPSHOT, level: "H" })).toBe(false);
    expect(snapshotsEqual(SNAPSHOT, { ...SNAPSHOT, text: "x" })).toBe(false);
  });
});

describe("export gating", () => {
  it("offers export only for a ready preview of the current input", () => {
    expect(canStartExport(READY, IDLE_EXPORT)).toBe(true);
    expect(canStartExport({ status: "pending" }, IDLE_EXPORT)).toBe(false);
    expect(canStartExport({ status: "idle" }, IDLE_EXPORT)).toBe(false);
    expect(
      canStartExport({ status: "error", message: "x" }, IDLE_EXPORT),
    ).toBe(false);
  });

  it("blocks a second export while one is in flight", () => {
    const prepared: PreparedQrExport = {
      grantId: "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
      operationId: "op-1",
      kind: "CREATE",
      recoveryPoint: "NONE_CREATED",
      target: "~/qr.png",
      proposedHash: "b".repeat(64),
    };
    const busy: QrExportView[] = [
      { status: "preparing" },
      { status: "awaiting", snapshot: SNAPSHOT, prepared },
      { status: "writing", snapshot: SNAPSHOT, prepared },
    ];
    for (const view of busy) {
      expect(isExportBusy(view)).toBe(true);
      expect(canStartExport(READY, view)).toBe(false);
    }
    expect(isExportBusy(IDLE_EXPORT)).toBe(false);
    expect(isExportBusy({ status: "cancelled" })).toBe(false);
  });

  it("does not offer export again after a stale or failed preview", () => {
    expect(canStartExport({ status: "error", message: "x" }, IDLE_EXPORT)).toBe(
      false,
    );
  });
});

describe("export confirmation text", () => {
  it("states an overwrite and its backup before the user confirms", () => {
    const { title, notes } = describePrepared({
      grantId: "g",
      operationId: "o",
      kind: "REPLACE",
      recoveryPoint: "BACKUP",
      target: "~/qr.png",
      currentHash: "c".repeat(64),
      proposedHash: "d".repeat(64),
    });
    expect(title).toContain("覆盖已有文件");
    expect(title).toContain("~/qr.png");
    expect(notes.join("\n")).toContain("备份");
  });

  it("states that a new file has no recovery point", () => {
    const { title, notes } = describePrepared({
      grantId: "g",
      operationId: "o",
      kind: "CREATE",
      recoveryPoint: "NONE_CREATED",
      target: "~/qr.png",
      proposedHash: "d".repeat(64),
    });
    expect(title).toContain("创建新文件");
    expect(notes.join("\n")).toContain("没有恢复点");
  });
});

describe("export outcomes never report a failed write as success", () => {
  const base: QrExportOutcome = {
    kind: "REPLACE",
    status: "SUCCEEDED",
    fileState: "WRITTEN",
    recoveryPoint: "BACKUP",
    backupId: "b-1",
    summary: "The file was written and verified.",
  };

  it("reports a verified overwrite as written, with its backup", () => {
    const view = exportOutcomeView("~/qr.png", base);
    expect(view).toEqual({
      status: "written",
      target: "~/qr.png",
      message: "覆盖完成，原文件已备份，并已回读校验。",
    });
  });

  it("reports a new file as written without a backup claim", () => {
    const view = exportOutcomeView("~/qr.png", {
      ...base,
      kind: "CREATE",
      recoveryPoint: "NONE_CREATED",
      backupId: undefined,
    });
    expect(view.status).toBe("written");
  });

  it("names the file state for every failure", () => {
    const failed = (fileState: QrExportOutcome["fileState"]) =>
      exportOutcomeView("~/qr.png", { ...base, status: "FAILED", fileState });

    expect(failed("UNCHANGED")).toEqual({
      status: "failed",
      message: "导出失败，文件未改动。",
    });
    const restoreFailed = failed("RESTORE_FAILED");
    expect(restoreFailed.status).toBe("failed");
    if (restoreFailed.status === "failed") {
      expect(restoreFailed.message).toContain("可能包含新内容");
    }
    for (const state of [
      "RESTORED",
      "CREATED_REMOVED",
      "CREATED_REMOVE_FAILED",
      "UNKNOWN",
    ] as const) {
      expect(failed(state).status).toBe("failed");
    }
  });
});
