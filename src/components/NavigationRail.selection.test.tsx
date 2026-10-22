// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROUTES, type AppRouteId } from "../app/routeDefinitions";
import { NavigationRail } from "./NavigationRail";

const ROW_HEIGHT = 32;

function items(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("nav a.slide-item")];
}

function rowIndex(element: HTMLElement): number {
  return Math.max(0, items().indexOf(element as HTMLAnchorElement));
}

const OFFSETS: Record<string, (element: HTMLElement) => number> = {
  offsetLeft: () => 0,
  offsetTop: (element) => rowIndex(element) * ROW_HEIGHT,
  offsetWidth: () => 180,
  offsetHeight: () => 28,
};

const originalDescriptors = Object.keys(OFFSETS).map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);

function stubLayout() {
  for (const [name, measure] of Object.entries(OFFSETS)) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return measure(this);
      },
    });
  }
}

function restoreLayout() {
  Object.keys(OFFSETS).forEach((name, index) => {
    const descriptor = originalDescriptors[index];
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
}

function Harness({ initial }: { initial: AppRouteId }) {
  const [routeId, setRouteId] = useState<AppRouteId>(initial);
  return (
    <NavigationRail
      activeRouteId={routeId}
      onNavigate={setRouteId}
      routes={APP_ROUTES}
    />
  );
}

function indicatorY(): string {
  const nav = document.querySelector<HTMLElement>("nav.navigation-rail")!;
  return nav.style.getPropertyValue("--slide-y");
}

describe("侧栏选中框：单一选中标记与滑动", () => {
  afterEach(() => {
    cleanup();
    restoreLayout();
  });

  it("渲染后只有一个 aria-current 标记，且选中项不带额外的选中类", () => {
    stubLayout();
    const { container } = render(<Harness initial="caddy" />);
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("#caddy");
    expect(current[0].className).toBe("slide-item");
    expect(container.querySelectorAll(".navigation-rail a.slide-item")).toHaveLength(
      APP_ROUTES.filter((route) => route.group).length,
    );
  });

  it("点击其他项：只保留一个选中标记，指示器测量到新项的纵向位置", () => {
    stubLayout();
    const { container } = render(<Harness initial="dashboard" />);
    const dashboardIndex = rowIndex(container.querySelector('a[href="#dashboard"]')!);
    expect(indicatorY()).toBe(`${dashboardIndex * ROW_HEIGHT}px`);

    const caddy = container.querySelector<HTMLAnchorElement>('a[href="#caddy"]')!;
    act(() => {
      fireEvent.click(caddy);
    });

    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(caddy.getAttribute("aria-current")).toBe("page");
    expect(indicatorY()).toBe(`${rowIndex(caddy) * ROW_HEIGHT}px`);
  });

  it("点击当前已选中的项不改变选中标记，也不移动指示器", () => {
    stubLayout();
    const { container } = render(<Harness initial="caddy" />);
    const before = indicatorY();
    act(() => {
      fireEvent.click(container.querySelector('a[href="#caddy"]')!);
    });
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(indicatorY()).toBe(before);
  });
});
