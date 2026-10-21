import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createInternalError } from "./core";
import {
  clearQrIcon,
  decodeQrIconSummary,
  decodeSelectQrIconOutcome,
  exportQrArgs,
  previewQrArgs,
  selectQrIcon,
} from "./qr";

const HASH = "a".repeat(64);
const THUMB = "iVBORw0KGgoAAAANSUhEUg==";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    iconId: "icon-1",
    format: "PNG",
    width: 64,
    height: 32,
    thumbnailPngBase64: THUMB,
    ...overrides,
  };
}

function thrownBy(decode: () => unknown): unknown {
  try {
    decode();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("icon summary decoding", () => {
  it("decodes a selected icon and a cancelled selection", () => {
    expect(decodeSelectQrIconOutcome({ status: "CANCELLED" })).toEqual({
      status: "CANCELLED",
    });
    expect(
      decodeSelectQrIconOutcome({ status: "SELECTED", ...summary() }),
    ).toEqual({ status: "SELECTED", ...summary() });
  });

  it("accepts only the three formats the backend can report", () => {
    for (const format of ["PNG", "JPEG", "WEBP"]) {
      expect(decodeQrIconSummary(summary({ format })).format).toBe(format);
    }
    for (const format of ["GIF", "SVG", "png", "/Users/x/logo.png"]) {
      expect(thrownBy(() => decodeQrIconSummary(summary({ format })))).toEqual(
        createInternalError(),
      );
    }
  });

  it("refuses a thumbnail that is not a PNG data payload", () => {
    for (const thumbnailPngBase64 of ["PHN2Zz48L3N2Zz4=", "not base64!"]) {
      expect(
        thrownBy(() => decodeQrIconSummary(summary({ thumbnailPngBase64 }))),
      ).toEqual(createInternalError());
    }
  });

  it("refuses non-positive or fractional dimensions and a missing id", () => {
    expect(thrownBy(() => decodeQrIconSummary(summary({ width: 0 })))).toEqual(
      createInternalError(),
    );
    expect(
      thrownBy(() => decodeQrIconSummary(summary({ height: 1.5 }))),
    ).toEqual(createInternalError());
    expect(
      thrownBy(() => decodeQrIconSummary(summary({ iconId: undefined }))),
    ).toEqual(createInternalError());
  });

  it("refuses an unknown selection status", () => {
    expect(
      thrownBy(() => decodeSelectQrIconOutcome({ status: "PATH", path: "/x" })),
    ).toEqual(createInternalError());
  });
});

describe("icon-aware request arguments", () => {
  it("omits the icon id when no icon is chosen", () => {
    const args = previewQrArgs({ text: "t", level: "M", size: 512 });
    expect(args).toEqual({ input: { text: "t", level: "M", size: 512 } });
    expect("iconId" in args.input).toBe(false);
  });

  it("sends only the opaque icon id, never a path", () => {
    expect(
      previewQrArgs({ text: "t", level: "M", size: 512, iconId: "icon-1" }),
    ).toEqual({ input: { text: "t", level: "M", size: 512, iconId: "icon-1" } });
    expect(
      exportQrArgs({
        text: "t",
        level: "H",
        size: 512,
        expectedSha256: HASH,
        iconId: "icon-1",
      }),
    ).toEqual({
      input: {
        text: "t",
        level: "H",
        size: 512,
        expectedSha256: HASH,
        iconId: "icon-1",
      },
    });
  });
});

describe("icon invoke wrappers", () => {
  afterEach(() => clearMocks());

  it("selects an icon and clears it through their commands", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "select_qr_icon") return { status: "CANCELLED" };
      return null;
    });

    await expect(selectQrIcon()).resolves.toEqual({ status: "CANCELLED" });
    await expect(clearQrIcon()).resolves.toBeUndefined();
    expect(calls).toEqual(["select_qr_icon", "clear_qr_icon"]);
  });
});
