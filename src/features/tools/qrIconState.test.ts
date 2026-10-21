import { describe, expect, it } from "vitest";
import {
  ICON_RULES_TEXT,
  describeIcon,
  effectiveLevel,
  iconLevelNotice,
  inputProblem,
  snapshotsEqual,
  type QrSnapshot,
} from "./qrToolState";
import type { QrIconSummary } from "../../ipc/qr";

const ICON: QrIconSummary = {
  iconId: "icon-1",
  format: "PNG",
  width: 64,
  height: 32,
  thumbnailPngBase64: "iVBORw0KGgoAAAANSUhEUg==",
};

const SNAPSHOT: QrSnapshot = { text: "https://example.com", level: "M", size: "512" };

describe("icon level rules", () => {
  it("uses level H whenever an icon is chosen", () => {
    expect(effectiveLevel("L", ICON.iconId)).toBe("H");
    expect(effectiveLevel("M", ICON.iconId)).toBe("H");
    expect(effectiveLevel("M", undefined)).toBe("M");
  });

  it("explains the forced level only when a lower level was picked", () => {
    expect(iconLevelNotice("M", ICON.iconId)).toContain("H");
    expect(iconLevelNotice("H", ICON.iconId)).toBeUndefined();
    expect(iconLevelNotice("M", undefined)).toBeUndefined();
  });

  it("applies the level H byte limit once an icon is chosen", () => {
    const text = "a".repeat(1274);
    expect(inputProblem(text, effectiveLevel("M", undefined))).toBeUndefined();
    expect(inputProblem(text, effectiveLevel("M", ICON.iconId))).toContain("H");
  });
});

describe("icon display text", () => {
  it("shows the decoded format and pixel size", () => {
    expect(describeIcon(ICON)).toBe("PNG · 64 × 32 px");
  });

  it("states the level H rule and the 15 percent limit", () => {
    expect(ICON_RULES_TEXT).toContain("H");
    expect(ICON_RULES_TEXT).toContain("15%");
  });
});

describe("snapshots with icons", () => {
  it("treats a different or added icon as a different snapshot", () => {
    expect(snapshotsEqual(SNAPSHOT, { ...SNAPSHOT, iconId: "icon-1" })).toBe(false);
    expect(
      snapshotsEqual(
        { ...SNAPSHOT, iconId: "icon-1" },
        { ...SNAPSHOT, iconId: "icon-2" },
      ),
    ).toBe(false);
    expect(
      snapshotsEqual(
        { ...SNAPSHOT, iconId: "icon-1" },
        { ...SNAPSHOT, iconId: "icon-1" },
      ),
    ).toBe(true);
  });
});
