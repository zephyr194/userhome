// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../Button";
import { InfoTip } from "../InfoTip";
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

describe("TextAreaField expandable editor", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no editor trigger unless expandable is set", () => {
    const markup = renderToStaticMarkup(
      <TextAreaField label="输入" value="" onValueChange={() => undefined} />,
    );
    expect(markup).not.toContain("在独立框中打开");
    expect(markup).not.toContain("field-emphasis");
  });

  it("renders an icon trigger named after the field, and emphasis when asked", () => {
    const markup = renderToStaticMarkup(
      <TextAreaField label="输入" value="" expandable emphasis />,
    );
    expect(markup).toContain('aria-label="在独立框中打开输入"');
    expect(markup).toContain("field-emphasis");
  });

  it("writes the edited draft back on done", async () => {
    const onValueChange = vi.fn();
    render(
      <TextAreaField
        label="输入"
        value="原始文本"
        onValueChange={onValueChange}
        expandable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在独立框中打开输入" }));
    const dialog = await screen.findByRole("dialog");
    const editor = within(dialog).getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.value).toBe("原始文本");
    await waitFor(() => expect(document.activeElement).toBe(editor));

    fireEvent.change(editor, { target: { value: "新文本" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(onValueChange).toHaveBeenLastCalledWith("新文本");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "在独立框中打开输入" }),
      ),
    );
  });

  it("discards the draft on cancel", async () => {
    const onValueChange = vi.fn();
    render(
      <TextAreaField
        label="输入"
        value="原始文本"
        onValueChange={onValueChange}
        expandable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在独立框中打开输入" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "放弃的文本" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("closes on Escape without writing back", async () => {
    const onValueChange = vi.fn();
    render(
      <TextAreaField
        label="输入"
        value="原始文本"
        onValueChange={onValueChange}
        expandable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在独立框中打开输入" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "放弃的文本" },
    });
    fireEvent.keyDown(within(dialog).getByRole("textbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("tip slot beside field titles", () => {
  afterEach(() => cleanup());

  const TIP = (title: string) => <InfoTip description="关闭后仍可从托盘打开。" title={title} />;

  it("puts the tip beside the switch title and keeps it out of the accessible name", () => {
    render(<SwitchField label="启动时打开主窗口" tip={TIP("启动时打开主窗口")} />);

    const label = screen.getByText("启动时打开主窗口", { selector: "label" });
    expect(label.querySelector("button")).toBeNull();
    expect(screen.getByRole("switch", { name: "启动时打开主窗口" })).toBeTruthy();
  });

  it("puts the tip beside the checkbox title and select title", () => {
    render(
      <>
        <CheckboxField label="用户级设置" tip={TIP("用户级设置")} />
        <SelectField
          label="关闭主窗口时"
          tip={TIP("关闭主窗口时")}
          options={[{ value: "a", label: "隐藏到托盘" }]}
          value="a"
        />
      </>,
    );

    expect(screen.getByRole("checkbox", { name: "用户级设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：用户级设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭主窗口时" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：关闭主窗口时" })).toBeTruthy();
  });

  it("names the radio group by its title alone and keeps option descriptions visible", () => {
    render(
      <RadioCardGroup
        label="外观模式"
        tip={TIP("外观模式")}
        value="a"
        options={[{ value: "a", label: "系统", description: "跟随系统设置。" }]}
        onValueChange={() => undefined}
      />,
    );

    expect(screen.getByRole("group", { name: "外观模式" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：外观模式" })).toBeTruthy();
    expect(screen.getByText("跟随系统设置。")).toBeTruthy();
  });

  it("renders no tip when the slot is empty", () => {
    render(<SwitchField label="启动时打开主窗口" />);

    expect(screen.queryByRole("button", { name: /说明：/ })).toBeNull();
  });
});
