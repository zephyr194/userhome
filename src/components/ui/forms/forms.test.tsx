import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../Button";
import {
  CheckboxField,
  RadioCardGroup,
  SecretReplacementField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "./index";

describe("Headless UI form primitives", () => {
  it("renders text fields with labels, help, required and invalid feedback", () => {
    const markup = renderToStaticMarkup(
      <TextField
        label="用户名"
        description="用于本机配置。"
        error="用户名无效。"
        name="userName"
        required
        defaultValue="alice"
      />,
    );

    expect(markup).toContain("用户名");
    expect(markup).toContain("用于本机配置。");
    expect(markup).toContain("用户名无效。");
    expect(markup).toContain('name="userName"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
  });

  it("renders textarea and select controls from shared data APIs", () => {
    const area = renderToStaticMarkup(
      <TextAreaField label="内容" name="content" defaultValue="hello" />,
    );
    const select = renderToStaticMarkup(
      <SelectField
        label="模式"
        name="mode"
        defaultValue="safe"
        options={[
          { value: "safe", label: "安全" },
          { value: "advanced", label: "高级" },
        ]}
      />,
    );

    expect(area).toContain("textarea");
    expect(area).toContain('name="content"');
    expect(select).toContain('value="safe"');
    expect(select).toContain('value="advanced"');
    expect(select).toContain("安全");
  });

  it("keeps checkbox, switch and radio values form-compatible", () => {
    const checkbox = renderToStaticMarkup(
      <CheckboxField label="自动清理" name="prune" defaultChecked />,
    );
    const toggle = renderToStaticMarkup(
      <SwitchField label="启动时刷新" name="refresh" defaultChecked />,
    );
    const radios = renderToStaticMarkup(
      <RadioCardGroup
        label="外观"
        name="appearance"
        defaultValue="SYSTEM"
        options={[
          { value: "SYSTEM", label: "系统" },
          { value: "DARK", label: "深色" },
        ]}
      />,
    );

    expect(checkbox).toContain('role="checkbox"');
    expect(toggle).toContain('role="switch"');
    expect(radios).toContain('role="radiogroup"');
    expect(radios).toContain('role="radio"');
  });

  it("keeps secret replacement fields empty and browser-safe", () => {
    const markup = renderToStaticMarkup(
      <SecretReplacementField label="新令牌" name="token" />,
    );

    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain('spellCheck="false"');
    expect(markup).not.toContain("current-secret");
  });

  it("uses the Headless UI button while preserving the default type", () => {
    const markup = renderToStaticMarkup(<Button>保存</Button>);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-headlessui-state=""');
  });
});
