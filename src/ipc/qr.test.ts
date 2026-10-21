import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  confirmQrExport,
  confirmQrExportArgs,
  decodePrepareQrExportOutcome,
  decodeQrExportOutcome,
  decodeQrPreview,
  exportQrArgs,
  previewQr,
  previewQrArgs,
  prepareQrExport,
} from "./qr";

const HASH = "a".repeat(64);
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUg==";
const GRANT_ID = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

function expectInternal(decode: () => unknown) {
  let thrown: unknown;
  try {
    decode();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toEqual({
    code: "INTERNAL",
    message: "An internal error occurred.",
    retryable: false,
  });
}

const preview = {
  pngBase64: PNG_BASE64,
  sha256: HASH,
  imagePx: 512,
  modulePx: 6,
  moduleCount: 77,
};

describe("preview_qr decoding", () => {
  it("decodes a PNG preview with its hash and geometry", () => {
    expect(decodeQrPreview(preview)).toEqual(preview);
  });

  it("refuses malformed PNG payloads", () => {
    expectInternal(() => decodeQrPreview({ ...preview, pngBase64: "not png!" }));
    expectInternal(() =>
      decodeQrPreview({ ...preview, pngBase64: "AAAAAAAAAAAA" }),
    );
    expectInternal(() => decodeQrPreview({ ...preview, sha256: "XYZ" }));
    expectInternal(() => decodeQrPreview({ ...preview, modulePx: 0 }));
    expectInternal(() => decodeQrPreview({ ...preview, imagePx: 1.5 }));
    expectInternal(() => decodeQrPreview(null));
  });
});

describe("prepare_qr_export decoding", () => {
  it("treats a cancelled save panel as a cancelled outcome, not a success", () => {
    expect(decodePrepareQrExportOutcome({ status: "CANCELLED" })).toEqual({
      status: "CANCELLED",
    });
  });

  it("decodes a previewed replace with its backup promise", () => {
    expect(
      decodePrepareQrExportOutcome({
        status: "PREVIEWED",
        grantId: GRANT_ID,
        operationId: "op-1",
        kind: "REPLACE",
        recoveryPoint: "BACKUP",
        target: "~/qr.png",
        currentHash: HASH,
        proposedHash: HASH,
      }),
    ).toEqual({
      status: "PREVIEWED",
      grantId: GRANT_ID,
      operationId: "op-1",
      kind: "REPLACE",
      recoveryPoint: "BACKUP",
      target: "~/qr.png",
      currentHash: HASH,
      proposedHash: HASH,
    });
  });

  it("decodes a new file without a current hash", () => {
    const outcome = decodePrepareQrExportOutcome({
      status: "PREVIEWED",
      grantId: GRANT_ID,
      operationId: "op-2",
      kind: "CREATE",
      recoveryPoint: "NONE_CREATED",
      target: "~/qr.png",
      proposedHash: HASH,
    });
    expect(outcome).toMatchObject({ kind: "CREATE" });
    expect(outcome).not.toHaveProperty("currentHash");
  });

  it("refuses unknown statuses, kinds and recovery points", () => {
    expectInternal(() => decodePrepareQrExportOutcome({ status: "SAVED" }));
    expectInternal(() =>
      decodePrepareQrExportOutcome({
        status: "PREVIEWED",
        grantId: GRANT_ID,
        operationId: "op",
        kind: "DELETE",
        recoveryPoint: "BACKUP",
        target: "t",
        proposedHash: HASH,
      }),
    );
    expectInternal(() =>
      decodePrepareQrExportOutcome({
        status: "PREVIEWED",
        grantId: GRANT_ID,
        operationId: "op",
        kind: "CREATE",
        recoveryPoint: "MAYBE",
        target: "t",
        proposedHash: HASH,
      }),
    );
  });
});

describe("confirm_qr_export decoding", () => {
  const written = {
    kind: "CREATE",
    status: "SUCCEEDED",
    fileState: "WRITTEN",
    recoveryPoint: "NONE_CREATED",
    summary: "The file was created and verified.",
  };

  it("decodes a verified write", () => {
    expect(decodeQrExportOutcome(written)).toEqual(written);
  });

  it("keeps a failed write visibly failed with its file state", () => {
    const failed = {
      ...written,
      status: "FAILED",
      fileState: "RESTORED",
      recoveryPoint: "BACKUP",
      backupId: "b-1",
      error: {
        code: "VALIDATION_FAILED",
        message: "The written file does not match the previewed content.",
        retryable: false,
      },
    };
    expect(decodeQrExportOutcome(failed)).toEqual(failed);
  });

  it("refuses unknown file states and malformed errors", () => {
    expectInternal(() =>
      decodeQrExportOutcome({ ...written, fileState: "MAYBE" }),
    );
    expectInternal(() => decodeQrExportOutcome({ ...written, status: "OK" }));
    expectInternal(() => decodeQrExportOutcome({ ...written, summary: 3 }));
  });
});

describe("QR command arguments", () => {
  it("sends only text, level and size for a preview", () => {
    expect(
      previewQrArgs({ text: "https://example.com", level: "M", size: 512 }),
    ).toEqual({
      input: { text: "https://example.com", level: "M", size: 512 },
    });
  });

  it("sends the previewed hash with the export, and no path", () => {
    expect(
      exportQrArgs({
        text: "x",
        level: "H",
        size: 1024,
        expectedSha256: HASH,
      }),
    ).toEqual({
      input: { text: "x", level: "H", size: 1024, expectedSha256: HASH },
    });
  });

  it("confirms only by operation and grant", () => {
    expect(
      confirmQrExportArgs({ operationId: "op-1", grantId: GRANT_ID }),
    ).toEqual({ input: { operationId: "op-1", grantId: GRANT_ID } });
  });
});

describe("QR invoke wrappers", () => {
  afterEach(() => clearMocks());

  it("calls the three commands with their arguments", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "preview_qr") return preview;
      if (cmd === "prepare_qr_export") return { status: "CANCELLED" };
      return {
        kind: "CREATE",
        status: "SUCCEEDED",
        fileState: "WRITTEN",
        recoveryPoint: "NONE_CREATED",
        summary: "ok",
      };
    });

    await previewQr({ text: "t", level: "L", size: 256 });
    await prepareQrExport({
      text: "t",
      level: "L",
      size: 256,
      expectedSha256: HASH,
    });
    await confirmQrExport({ operationId: "op", grantId: GRANT_ID });

    expect(calls.map((call) => call.cmd)).toEqual([
      "preview_qr",
      "prepare_qr_export",
      "confirm_qr_export",
    ]);
  });
});
