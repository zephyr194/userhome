import { describe, expect, it } from "vitest";
import { grantPurposeLabel, type GrantPurpose } from "./grants";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

const PURPOSES: readonly GrantPurpose[] = [
  "CONFIG_DIRECTORY",
  "CONFIG_FILE",
  "EXECUTABLE",
  "SHELL_STARTUP_FILE",
  "LAUNCH_AGENT_FILE",
  "TLS_MATERIAL_FILE",
  "CADDY_WORK_DIR",
];

describe("grantPurposeLabel", () => {
  it("keeps the zh-CN labels by default", () => {
    expect(grantPurposeLabel("CONFIG_FILE")).toBe("配置文件");
  });

  it.each(PURPOSES)("returns an English label for %s", (purpose) => {
    const label = grantPurposeLabel(purpose, "en");
    expect(label).not.toBe("");
    expect(CJK_PATTERN.test(label)).toBe(false);
  });
});
