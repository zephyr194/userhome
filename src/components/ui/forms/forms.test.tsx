// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(select).toContain('aria-haspopup="listbox"');
    expect(select).toContain("安全");
    expect(select).not.toContain('role="option"');
  });

  it("renders select as a closed Listbox trigger with error and disabled states", () => {
    const markup = renderToStaticMarkup(
      <SelectField
        label="模式"
        name="mode"
        value="advanced"
        error="请选择模式。"
        disabled
        options={[
          { value: "safe", label: "安全" },
          { value: "advanced", label: "高级" },
        ]}
      />,
    );

    expect(markup).toMatch(/<button\b[^>]*aria-haspopup="listbox"/);
    expect(markup).toMatch(/<button\b[^>]*aria-expanded="false"/);
    expect(markup).toMatch(/<button\b[^>]*aria-invalid="true"/);
    expect(markup).toMatch(/<button\b[^>]*disabled=""/);
    expect(markup).toContain("高级");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<option");
    expect(markup).not.toContain('role="option"');
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

  it("does not mix controlled and default values for secret replacements", () => {
    const markup = renderToStaticMarkup(
      <SecretReplacementField label="新令牌" name="token" value="draft" />,
    );
    expect(markup).toContain('value="draft"');
    expect(markup).not.toContain('defaultValue=');
  });

  it("uses the Headless UI button while preserving the default type", () => {
    const markup = renderToStaticMarkup(<Button>保存</Button>);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-headlessui-state=""');
  });
});

describe("SelectField Listbox interaction", () => {
  beforeEach(() => {
    // jsdom 没有 ResizeObserver；Headless UI 键盘移动焦点时会无守卫地构造它。空实现只满足构造，不改键盘逻辑。生产 WebKit 有该 API。
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const OPTIONS = [
    { value: "safe", label: "安全" },
    { value: "standard", label: "标准" },
    { value: "retired", label: "已停用", disabled: true },
    { value: "advanced", label: "高级" },
  ];

  function renderSelect(onValueChange = vi.fn()) {
    render(
      <SelectField
        label="模式"
        name="mode"
        value="safe"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    );
    const trigger = screen.getByRole("button", { name: "模式" });
    fireEvent.click(trigger);
    return { trigger, onValueChange, listbox: screen.getByRole("listbox") };
  }

  function activeOption(): string | undefined {
    return screen
      .getAllByRole("option")
      .find((option) => option.hasAttribute("data-focus"))?.textContent ?? undefined;
  }

  it("opens a listbox of role=option items with the current one selected", () => {
    const { trigger } = renderSelect();

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "安全",
      "标准",
      "已停用",
      "高级",
    ]);
    expect(
      screen.getByRole("option", { name: "安全" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("does not select a disabled option", () => {
    const { onValueChange } = renderSelect();

    const retired = screen.getByRole("option", { name: "已停用" });
    expect(retired.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(retired);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("moves through options with the arrows, Home and End", async () => {
    const { listbox } = renderSelect();

    await waitFor(() => expect(activeOption()).toBe("安全"));
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    await waitFor(() => expect(activeOption()).toBe("标准"));
    fireEvent.keyDown(listbox, { key: "End" });
    await waitFor(() => expect(activeOption()).toBe("高级"));
    fireEvent.keyDown(listbox, { key: "Home" });
    await waitFor(() => expect(activeOption()).toBe("安全"));
  });

  it("selects the active option with Enter and with Space", async () => {
    const { trigger, listbox, onValueChange } = renderSelect();

    await waitFor(() => expect(activeOption()).toBe("安全"));
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    await waitFor(() => expect(activeOption()).toBe("标准"));
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith("standard");

    fireEvent.click(trigger);
    const reopened = await screen.findByRole("listbox");
    fireEvent.keyDown(reopened, { key: "End" });
    await waitFor(() => expect(activeOption()).toBe("高级"));
    fireEvent.keyDown(reopened, { key: " " });
    expect(onValueChange).toHaveBeenLastCalledWith("advanced");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { trigger, listbox } = renderSelect();

    await waitFor(() => expect(activeOption()).toBe("安全"));
    fireEvent.keyDown(listbox, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("submits the selected value through the name attribute", () => {
    render(
      <SelectField
        label="模式"
        name="mode"
        value="advanced"
        options={OPTIONS}
      />,
    );

    const hidden = document.querySelector<HTMLInputElement>(
      'input[name="mode"]',
    );
    expect(hidden?.value).toBe("advanced");
  });
});

describe("checkbox, switch and radio layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("puts the switch control before its label, with help text under the label", () => {
    const markup = renderToStaticMarkup(
      <SwitchField label="启动时刷新" description="登录后自动刷新。" name="refresh" />,
    );

    const control = markup.indexOf('role="switch"');
    const label = markup.indexOf("启动时刷新");
    const help = markup.indexOf("登录后自动刷新。");
    expect(control).toBeGreaterThan(-1);
    expect(control).toBeLessThan(label);
    expect(label).toBeLessThan(help);
    expect(markup).toContain("col-start-2");
  });

  it("keeps a visible switch track and knob in the off and on states", () => {
    const off = renderToStaticMarkup(<SwitchField label="开关" name="s" />);
    const on = renderToStaticMarkup(<SwitchField label="开关" name="s" defaultChecked />);

    expect(off).toContain("switch-track");
    expect(off).toContain("switch-thumb");
    expect(off).toContain('aria-checked="false"');
    expect(on).toContain('aria-checked="true"');
  });

  it("draws the checkbox check mark as an inline svg and places the label after the box", () => {
    const markup = renderToStaticMarkup(
      <CheckboxField label="自动清理" name="prune" defaultChecked />,
    );

    expect(markup).toMatch(/<svg\b[^>]*aria-hidden="true"/);
    expect(markup).not.toContain("✓");
    expect(markup.indexOf('role="checkbox"')).toBeLessThan(markup.indexOf("自动清理"));
  });

  it("marks an invalid checkbox with a danger border and an alert", () => {
    const markup = renderToStaticMarkup(
      <CheckboxField label="同意条款" name="terms" error="请先同意条款。" />,
    );

    expect(markup).toContain("border-danger");
    expect(markup).toContain('role="alert"');
  });
});

describe("checkbox, switch and radio interaction", () => {
  afterEach(() => {
    cleanup();
  });

  it("toggles a switch from its label and reports the new state", () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchField label="启动时刷新" name="refresh" onCheckedChange={onCheckedChange} />,
    );
    const toggle = screen.getByRole("switch", { name: "启动时刷新" });

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByText("启动时刷新"));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it("toggles a checkbox from its label", () => {
    render(<CheckboxField label="自动清理" name="prune" />);
    const box = screen.getByRole("checkbox", { name: "自动清理" });

    fireEvent.click(screen.getByText("自动清理"));
    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("does not toggle a disabled switch or checkbox", () => {
    render(
      <>
        <SwitchField label="开关" name="s" disabled />
        <CheckboxField label="复选" name="c" disabled />
      </>,
    );

    fireEvent.click(screen.getByRole("switch", { name: "开关" }));
    fireEvent.click(screen.getByText("复选"));
    expect(screen.getByRole("switch", { name: "开关" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "复选" }).getAttribute("aria-checked")).toBe("false");
  });

  it("selects a radio card and renders a dot indicator on every card", () => {
    const onValueChange = vi.fn();
    render(
      <RadioCardGroup
        label="外观"
        name="appearance"
        defaultValue="SYSTEM"
        onValueChange={onValueChange}
        options={[
          { value: "SYSTEM", label: "系统" },
          { value: "DARK", label: "深色" },
        ]}
      />,
    );
    const system = screen.getByRole("radio", { name: "系统" });
    const dark = screen.getByRole("radio", { name: "深色" });

    expect(system.hasAttribute("data-checked")).toBe(true);
    expect(dark.hasAttribute("data-checked")).toBe(false);
    expect(system.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    expect(dark.querySelector('span[aria-hidden="true"]')).not.toBeNull();

    fireEvent.click(dark);
    expect(onValueChange).toHaveBeenLastCalledWith("DARK");
    expect(dark.hasAttribute("data-checked")).toBe(true);
  });
});
