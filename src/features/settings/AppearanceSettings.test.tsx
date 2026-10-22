import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

describe("外观主题卡片（r4-fe5）", () => {
  const html = renderToStaticMarkup(
    <AppearanceSettings appearance="SYSTEM" onChange={() => Promise.resolve()} />,
  );

  it("三个主题卡片排成三列，窄窗口退为一列", () => {
    expect(html).toContain("sm:grid-cols-3");
    expect(html).not.toContain("sm:grid-cols-2");
  });

  it("三个选项都在同一组中", () => {
    for (const label of ["系统", "浅色", "深色"]) {
      expect(html).toContain(`>${label}</span>`);
    }
  });
});
