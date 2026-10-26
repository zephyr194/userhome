// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  lagging,
  axis = "y",
  level,
}: {
  selected: string;
  lagging?: string;
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
            aria-selected={lagging === id ? "true" : undefined}
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

  it("向上移动选中时，Headless UI 尚未更新的旧 aria-selected 不得抢走测量（aria-current 优先）", () => {
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container, rerender } = render(<Harness selected="third" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    rerender(<Harness selected="first" lagging="third" />);
    expect(list?.style.getPropertyValue("--slide-x")).toBe("0px");
    expect(list?.style.getPropertyValue("--slide-y")).toBe("0px");
    expect(list?.style.getPropertyValue("--slide-w")).toBe("120px");
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

describe("useSlideIndicator 非选中变化", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(0);
    });
  }

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    stubLayout();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    document.documentElement.lang = "";
  });

  it("首次测量先置 data-slide-instant，下一帧移除", () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    expect(list?.hasAttribute("data-slide-instant")).toBe(true);
    flushFrames();
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("前面的项换行使选中项下移（尺寸不变）时，观察者回调立即到位并置 instant", () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
    flushFrames();
    second.dataset.offsetTop = "48";
    act(() => observers[observers.length - 1].callback());
    expect(list?.style.getPropertyValue("--slide-y")).toBe("48px");
    expect(list?.hasAttribute("data-slide-instant")).toBe(true);
    flushFrames();
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("没有变化时不置 instant，避免打断正在进行的滑动", () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    flushFrames();
    act(() => observers[observers.length - 1].callback());
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("选中变化时始终不置 instant，保留 240ms 滑动", () => {
    const { container, rerender } = render(<Harness selected="first" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    flushFrames();
    rerender(<Harness selected="third" />);
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
    expect(list?.style.getPropertyValue("--slide-y")).toBe("64px");
    flushFrames();
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("文字或子树变化（如换语言）经 MutationObserver 节流到下一帧再测量", async () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
    flushFrames();
    await act(async () => {
      second.textContent = "second, wrapped onto two lines";
      second.dataset.offsetHeight = "44";
    });
    expect(list?.style.getPropertyValue("--slide-h")).toBe("28px");
    flushFrames();
    expect(list?.style.getPropertyValue("--slide-h")).toBe("44px");
    expect(list?.hasAttribute("data-slide-instant")).toBe(true);
    flushFrames();
    expect(list?.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("document.documentElement.lang 变化后重新测量", async () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
    flushFrames();
    second.dataset.offsetTop = "52";
    await act(async () => {
      document.documentElement.lang = "en";
    });
    flushFrames();
    expect(list?.style.getPropertyValue("--slide-y")).toBe("52px");
  });

  it("字体加载完成后重新测量", () => {
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      const { container } = render(<Harness selected="second" />);
      const list = container.querySelector<HTMLElement>(".slide-list");
      const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
      flushFrames();
      second.dataset.offsetTop = "60";
      act(() => {
        fonts.dispatchEvent(new Event("loadingdone"));
      });
      flushFrames();
      expect(list?.style.getPropertyValue("--slide-y")).toBe("60px");
    } finally {
      delete (document as unknown as Record<string, unknown>).fonts;
    }
  });

  it("先写入坐标并强制回流，instant 只在之后的下一帧清除", () => {
    const { container } = render(<Harness selected="second" />);
    const list = container.querySelector<HTMLElement>(".slide-list")!;
    const second = container.querySelector<HTMLElement>('[data-testid="second"]')!;
    flushFrames();
    const log: string[] = [];
    const setProperty = list.style.setProperty.bind(list.style);
    vi.spyOn(list.style, "setProperty").mockImplementation((name, value, priority) => {
      if (name === "--slide-y") log.push(`write:${list.hasAttribute("data-slide-instant")}`);
      setProperty(name, value, priority);
    });
    const removeAttribute = list.removeAttribute.bind(list);
    vi.spyOn(list, "removeAttribute").mockImplementation((name) => {
      if (name === "data-slide-instant") log.push("clear");
      removeAttribute(name);
    });
    Object.defineProperty(list, "offsetHeight", {
      configurable: true,
      get: () => {
        log.push("reflow");
        return 0;
      },
    });
    second.dataset.offsetTop = "48";
    act(() => observers[observers.length - 1].callback());
    expect(log).toEqual(["write:true", "reflow"]);
    expect(list.hasAttribute("data-slide-instant")).toBe(true);
    flushFrames();
    expect(log).toEqual(["write:true", "reflow", "clear"]);
    expect(list.hasAttribute("data-slide-instant")).toBe(false);
  });
});
