// @vitest-environment jsdom
import { TabGroup } from "@headlessui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSlideLayout, stubSlideLayout } from "../../components/ui/slideLayoutStub";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";
import { SettingsSidebar } from "./SettingsSidebar";

const ROW_HEIGHT = 40;

function SidebarHarness({ initial }: { initial: SettingsGroupId }) {
  const [index, setIndex] = useState(SETTINGS_GROUPS.findIndex((group) => group.id === initial));
  return (
    <TabGroup as="div" vertical selectedIndex={index} onChange={setIndex}>
      <SettingsSidebar selectedGroup={SETTINGS_GROUPS[index].id} />
    </TabGroup>
  );
}

function slideY(container: HTMLElement): string {
  return container.querySelector<HTMLElement>(".slide-list")?.style.getPropertyValue("--slide-y") ?? "";
}

function rowOf(container: HTMLElement, id: SettingsGroupId): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-group-id="${id}"]`);
  if (!row) throw new Error(`missing row ${id}`);
  return row;
}

function indexOf(id: SettingsGroupId): number {
  return SETTINGS_GROUPS.findIndex((group) => group.id === id);
}

describe("SettingsSidebar 指示条", () => {
  beforeEach(() => {
    stubSlideLayout("y");
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    restoreSlideLayout();
    vi.unstubAllGlobals();
  });

  it("先选中下方的项，再点击上方的项时指示条立即移动到上方", () => {
    const { container } = render(<SidebarHarness initial="reset" />);
    expect(slideY(container)).toBe(`${indexOf("reset") * ROW_HEIGHT}px`);
    fireEvent.click(rowOf(container, "configuration"));
    expect(rowOf(container, "configuration").getAttribute("aria-current")).toBe("true");
    expect(slideY(container)).toBe(`${indexOf("configuration") * ROW_HEIGHT}px`);
  });

  it("键盘 ArrowUp 从下方逐项回到上方时指示条同步移动", () => {
    const { container } = render(<SidebarHarness initial="reset" />);
    let row = rowOf(container, "reset");
    row.focus();
    for (let step = 0; step < 3; step++) {
      fireEvent.keyDown(row, { key: "ArrowUp" });
      row = document.activeElement as HTMLElement;
      const selected = container.querySelector<HTMLElement>('.slide-item[aria-current="true"]');
      expect(selected).toBe(row);
      expect(slideY(container)).toBe(`${indexOf(row.dataset.groupId as SettingsGroupId) * ROW_HEIGHT}px`);
    }
  });
});
