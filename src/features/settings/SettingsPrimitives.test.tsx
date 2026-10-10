import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SettingsChoiceGroup,
  SettingsField,
  SettingsSection,
  SettingsValueField,
} from "./SettingsPrimitives";

describe("settings primitives typography", () => {
  it("uses group headings and aux descriptions without clipping", () => {
    const markup = renderToStaticMarkup(
      <SettingsSection title="外观" description="选择语义颜色。">
        <p>body</p>
      </SettingsSection>,
    );

    expect(markup).toContain("text-group");
    expect(markup).toContain("text-aux");
    expect(markup).toContain("break-words");
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });

  it("field labels are body-sized and descriptions aux-sized", () => {
    const field = renderToStaticMarkup(
      <SettingsField label="界面密度" description="平衡可扫描性。">
        <span>均衡</span>
      </SettingsField>,
    );
    expect(field).toContain("text-body");
    expect(field).toContain("text-aux");
    expect(field).toContain("break-words");

    const value = renderToStaticMarkup(
      <SettingsValueField label="动态效果" description="跟随系统。">
        跟随系统
      </SettingsValueField>,
    );
    expect(value).toContain("text-body");
    expect(value).toContain("text-aux");
  });

  it("choice groups expose a group legend and body labels", () => {
    const markup = renderToStaticMarkup(
      <SettingsChoiceGroup legend="外观模式" description="系统、浅色或深色。">
        <span>选择</span>
      </SettingsChoiceGroup>,
    );
    expect(markup).toContain("text-group");
    expect(markup).toContain("text-aux");
  });
});
