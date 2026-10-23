// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSlideIndicator, type SlideAxis, type SlideLevel } from "./useSlideIndicator";

const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;
const originalOffsets = OFFSETS.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);

function stubLayout() {
  for (const name of OFFSETS) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset[name] ?? 0);
      },
    });
  }
}

function restoreLayout() {
  OFFSETS.forEach((name, index) => {
    const descriptor = originalOffsets[index];
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
}

const observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  constructor(readonly callback: () => void) {
    observers.push(this);
  }
}

function Harness({
  selected,
  axis = "y",
  level,
}: {
  selected: string;
  axis?: SlideAxis;
  level?: SlideLevel;
}) {
  const ref = useSlideIndicator(selected, axis, level);
  return (
    <ul ref={ref} className="slide-list">
      {[
        ["first", 0, 0, 120, 28],
        ["second", 0, 32, 120, 28],
        ["third", 24, 64, 96, 28],
      ].map(([id, left, top, width, height]) => (
        <li key={id as string}>
          <button
            type="button"
            className="slide-item"
            aria-current={selected === id ? "true" : undefined}
            data-offset-left={left}
            data-offset-top={top}
            data-offset-width={width}
            data-offset-height={height}
            data-testid={id as string}
          >
            {id as string}
          </button>
        </li>
      ))}
    </ul>
  );
}

afterEach(() => {
  cleanup();
  restoreLayout();
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("useSlideIndicator", () => {
  it("把选中项的偏移与尺寸写入容器变量并置位 data-slide-ready", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.hasAttribute("data-slide-ready")).toBe(true);
    expect(list?.style.getPropertyValue("--slide-x")).toBe("0px");
    expect(list?.style.getPropertyValue("--slide-y")).toBe("32px");
    expect(list?.style.getPropertyValue("--slide-w")).toBe("120px");
    expect(list?.style.getPropertyValue("--slide-h")).toBe("28px");
  });

  it("选中变化时重新测量", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="first" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.style.getPropertyValue("--slide-y")).toBe("0px");
    rerender(<Harness selected="third" />);
    expect(list?.style.getPropertyValue("--slide-x")).toBe("24px");
    expect(list?.style.getPropertyValue("--slide-y")).toBe("64px");
    expect(list?.style.getPropertyValue("--slide-w")).toBe("96px");
  });

  it("没有选中项时保留上一次位置并标记 data-slide-empty，不摘掉 data-slide-ready", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    rerender(<Harness selected="missing" />);
    expect(list?.hasAttribute("data-slide-ready")).toBe(true);
    expect(list?.hasAttribute("data-slide-empty")).toBe(true);
    expect(list?.style.getPropertyValue("--slide-y")).toBe("32px");
    rerender(<Harness selected="third" />);
    expect(list?.hasAttribute("data-slide-empty")).toBe(false);
    expect(list?.style.getPropertyValue("--slide-y")).toBe("64px");
  });

  it("选中变化时始终是同一个容器元素，指示器有起点可以滑动", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="first" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    for (const selected of ["second", "third", "first"]) {
      rerender(<Harness selected={selected} />);
      expect(container.querySelector(".slide-list")).toBe(list);
      expect(list?.hasAttribute("data-slide-ready")).toBe(true);
    }
  });

  it("隐藏子树测量为 0 时保留上一次位置，显示后由尺寸观察者重新测量", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    const third = container.querySelector<HTMLElement>('[data-testid="third"]')!;
    rerender(<Harness selected="third" />);
    third.dataset.offsetWidth = "0";
    third.dataset.offsetHeight = "0";
    act(() => observers[observers.length - 1].callback());
    expect(list?.style.getPropertyValue("--slide-y")).toBe("64px");
    expect(list?.style.getPropertyValue("--slide-w")).toBe("96px");
    third.dataset.offsetWidth = "96";
    third.dataset.offsetHeight = "28";
    act(() => observers[observers.length - 1].callback());
    expect(list?.style.getPropertyValue("--slide-w")).toBe("96px");
  });

  it("观察选中项本身，选中项尺寸变化时重新测量", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
    expect(observers[0].observe).toHaveBeenCalledWith(list);
    expect(observers[0].observe).toHaveBeenCalledWith(second);
    second.dataset.offsetHeight = "44";
    act(() => observers[observers.length - 1].callback());
    expect(list?.style.getPropertyValue("--slide-h")).toBe("44px");
  });

  it("axis 为 x 时写入 data-slide-axis，并使用 left/width 滑动", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(<Harness selected="third" axis="x" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.getAttribute("data-slide-axis")).toBe("x");
    expect(list?.style.getPropertyValue("--slide-x")).toBe("24px");
    expect(list?.style.getPropertyValue("--slide-w")).toBe("96px");
  });

  it("默认是二级级别，level 为 primary 时写入 data-slide-level 并随变化更新", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="first" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.getAttribute("data-slide-level")).toBe("secondary");
    rerender(<Harness selected="first" level="primary" />);
    expect(list?.getAttribute("data-slide-level")).toBe("primary");
    rerender(<Harness selected="first" level="secondary" />);
    expect(list?.getAttribute("data-slide-level")).toBe("secondary");
  });

  it("卸载时断开 ResizeObserver", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { unmount } = render(<Harness selected="first" />);
    expect(observers).toHaveLength(1);
    const [observer] = observers;
    expect(observer.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("没有 ResizeObserver 时仍能测量", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(<Harness selected="first" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.hasAttribute("data-slide-ready")).toBe(true);
  });
});
