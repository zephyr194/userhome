// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoTip } from "./InfoTip";

const TITLE = "启动时刷新";
const DESCRIPTION = "打开应用时运行一次有界 provider 扫描。";

function renderTip() {
  render(<InfoTip description={DESCRIPTION} title={TITLE} />);
  const trigger = screen.getByRole("button", { name: `说明：${TITLE}` });
  const tooltip = screen.getByRole("tooltip", { hidden: true });
  return { trigger, tooltip };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InfoTip", () => {
  it("关联按钮与气泡：气泡默认隐藏但内容可读，按钮的 aria-describedby 指向它", () => {
    const { trigger, tooltip } = renderTip();

    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.textContent).toBe(DESCRIPTION);
    expect(tooltip.hidden).toBe(true);
  });

  it("悬停时显示，移开后隐藏", () => {
    const { trigger, tooltip } = renderTip();

    fireEvent.mouseEnter(trigger);
    expect(tooltip.hidden).toBe(false);

    fireEvent.mouseLeave(trigger);
    expect(tooltip.hidden).toBe(true);
  });

  it("键盘聚焦时显示，失焦后隐藏", () => {
    const { trigger, tooltip } = renderTip();

    act(() => trigger.focus());
    expect(tooltip.hidden).toBe(false);

    act(() => trigger.blur());
    expect(tooltip.hidden).toBe(true);
  });

  it("Esc 关闭气泡但保留焦点在按钮上", () => {
    const { trigger, tooltip } = renderTip();

    act(() => trigger.focus());
    expect(tooltip.hidden).toBe(false);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(tooltip.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("点击固定显示，点击外部后关闭", () => {
    const { trigger, tooltip } = renderTip();

    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    expect(tooltip.hidden).toBe(false);

    fireEvent.pointerDown(document.body);
    expect(tooltip.hidden).toBe(true);
  });

  it("靠近视口底部时翻转到按钮上方", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const isTooltip = this.getAttribute("role") === "tooltip";
        const top = isTooltip ? 0 : 700;
        const height = isTooltip ? 60 : 24;
        return {
          top,
          bottom: top + height,
          left: 10,
          right: isTooltip ? 210 : 34,
          width: isTooltip ? 200 : 24,
          height,
          x: 10,
          y: top,
          toJSON() {
            return this;
          },
        } as DOMRect;
      },
    );
    const { trigger, tooltip } = renderTip();

    fireEvent.mouseEnter(trigger);

    expect(tooltip.dataset.side).toBe("top");
    expect(tooltip.dataset.align).toBe("start");
  });
});
