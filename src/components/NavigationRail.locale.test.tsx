// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ROUTES, type AppRouteId } from "../app/routeDefinitions";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { NavigationRail } from "./NavigationRail";

const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;
const originalOffsets = OFFSETS.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);

// 英文标签更长：第二行换行，其后各行下移 14px，且换行的那一行变高。
function isEnglish() {
  return document.documentElement.lang === "en";
}

function rowIndex(element: HTMLElement): number {
  const rows = Array.from(element.closest(".slide-list")?.querySelectorAll(".slide-item") ?? []);
  return rows.indexOf(element);
}

function rowTop(index: number, english: boolean) {
  return 40 + index * 34 + (english && index >= 1 ? 14 : 0);
}

function rowHeight(index: number, english: boolean) {
  return english && index === 1 ? 42 : 28;
}

function stubReflowingLayout() {
  const getters: Record<(typeof OFFSETS)[number], (this: HTMLElement) => number> = {
    offsetLeft: () => 0,
    offsetWidth: function () {
      return this.classList.contains("slide-item") ? 180 : 0;
    },
    offsetTop: function () {
      const index = rowIndex(this);
      return index < 0 ? 0 : rowTop(index, isEnglish());
    },
    offsetHeight: function () {
      const index = rowIndex(this);
      return index < 0 ? 0 : rowHeight(index, isEnglish());
    },
  };
  for (const name of OFFSETS) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: getters[name],
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

describe("侧栏选中框与语言切换（集成）", () => {
  const ROUTE: AppRouteId = "environment";
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(0);
    });
  }

  function rail(
    preference: "zh-CN" | "en",
  ) {
    return (
      <LocaleProvider preference={preference}>
        <NavigationRail activeRouteId={ROUTE} onNavigate={() => undefined} routes={APP_ROUTES} />
      </LocaleProvider>
    );
  }

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    stubReflowingLayout();
    // 不依赖 ResizeObserver：语言切换必须由 lang 与子树变化两条路径触发重新测量。
    vi.stubGlobal("ResizeObserver", undefined);
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
    cleanup();
    restoreLayout();
    vi.unstubAllGlobals();
    document.documentElement.lang = "";
  });

  function expectIndicatorOnSelected(list: HTMLElement) {
    const selected = list.querySelector<HTMLElement>('[aria-current="page"]')!;
    const index = rowIndex(selected);
    const english = isEnglish();
    expect(selected.offsetTop).toBe(rowTop(index, english));
    expect(list.style.getPropertyValue("--slide-y")).toBe(`${selected.offsetTop}px`);
    expect(list.style.getPropertyValue("--slide-h")).toBe(`${selected.offsetHeight}px`);
    expect(list.style.getPropertyValue("--slide-w")).toBe(`${selected.offsetWidth}px`);
  }

  it("切换到英文后选中框与选中项的新位置和尺寸一致，且不卡在中间", async () => {
    const { container, rerender } = render(rail("zh-CN"));
    const list = container.querySelector<HTMLElement>(".slide-list")!;
    flushFrames();
    expectIndicatorOnSelected(list);

    await act(async () => {
      rerender(rail("en"));
    });
    flushFrames();
    expect(list.hasAttribute("data-slide-instant")).toBe(true);
    flushFrames();

    expect(container.querySelector(".slide-list")).toBe(list);
    expectIndicatorOnSelected(list);
    expect(list.hasAttribute("data-slide-instant")).toBe(false);
  });

  it("来回切换语言后仍与选中项一致", async () => {
    const { container, rerender } = render(rail("zh-CN"));
    const list = container.querySelector<HTMLElement>(".slide-list")!;
    flushFrames();

    for (const preference of ["en", "zh-CN", "en"] as const) {
      await act(async () => {
        rerender(rail(preference));
      });
      flushFrames();
      expectIndicatorOnSelected(list);
    }
  });
});
