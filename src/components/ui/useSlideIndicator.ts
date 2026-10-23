import { useLayoutEffect, useRef, useState } from "react";

export type SlideAxis = "x" | "y";
export type SlideLevel = "primary" | "secondary";

const SELECTED_ITEM = [
  ".slide-item[aria-current=\"true\"]",
  ".slide-item[aria-current=\"page\"]",
  ".slide-item[aria-selected=\"true\"]",
  ".slide-item[data-selected=\"true\"]",
].join(",");

const INSTANT = "data-slide-instant";
const EMPTY = "data-slide-empty";
const READY = "data-slide-ready";

/**
 * Positions the sliding selection indicator of a `.slide-list` container.
 * The container must be the offsetParent of its items (`position: relative`).
 * Nested selections (a route and one of its sections) resolve to the innermost
 * one, which is the last match in document order. The returned callback ref
 * re-measures when a conditionally rendered list mounts.
 *
 * Only a change of the selected key slides the indicator. Any other change of
 * the layout (an item resized or moved by a wrap, a text or language change,
 * a font load) re-measures at once with the transition switched off, so an
 * old slide never runs on towards stale coordinates. A subtree that is not
 * laid out (hidden) keeps the previous position. The level sets how strong the
 * selection reads: primary (orange, navigation) or secondary (neutral, lists).
 */
export function useSlideIndicator(
  selectedKey: unknown,
  axis: SlideAxis = "y",
  level: SlideLevel = "secondary",
) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const previous = useRef<{ list: HTMLElement; key: unknown } | null>(null);

  useLayoutEffect(() => {
    if (!container) return;
    const list = container;
    list.setAttribute("data-slide-axis", axis);
    list.setAttribute("data-slide-level", level);

    const animate = previous.current?.list === list && !Object.is(previous.current.key, selectedKey);
    previous.current = { list, key: selectedKey };

    let written = "";
    let scheduled = 0;
    let clearing = 0;
    const observed = new Set<HTMLElement>();

    const clearInstant = () => {
      clearing = 0;
      list.removeAttribute(INSTANT);
    };

    function schedule() {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        refresh(false);
      });
    }

    function observeItems() {
      if (!observer) return;
      const items = new Set(list.querySelectorAll<HTMLElement>(".slide-item"));
      for (const item of observed) {
        if (!items.has(item)) {
          observer.unobserve(item);
          observed.delete(item);
        }
      }
      for (const item of items) {
        if (!observed.has(item)) {
          observer.observe(item);
          observed.add(item);
        }
      }
    }

    function refresh(animateSelection: boolean) {
      observeItems();
      const matches = list.querySelectorAll<HTMLElement>(SELECTED_ITEM);
      const selected = matches[matches.length - 1];
      if (!selected) {
        list.setAttribute(EMPTY, "");
        return;
      }
      if (selected.offsetWidth === 0 && selected.offsetHeight === 0) return;
      list.removeAttribute(EMPTY);
      list.setAttribute(READY, "");
      const box = [selected.offsetLeft, selected.offsetTop, selected.offsetWidth, selected.offsetHeight].join("|");
      if (box === written) return;
      written = box;
      cancelAnimationFrame(clearing);
      if (animateSelection) list.removeAttribute(INSTANT);
      else list.setAttribute(INSTANT, "");
      list.style.setProperty("--slide-x", `${selected.offsetLeft}px`);
      list.style.setProperty("--slide-y", `${selected.offsetTop}px`);
      list.style.setProperty("--slide-w", `${selected.offsetWidth}px`);
      list.style.setProperty("--slide-h", `${selected.offsetHeight}px`);
      if (!animateSelection) clearing = requestAnimationFrame(clearInstant);
    }

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => refresh(false));
    const mutations = new MutationObserver(schedule);

    refresh(animate);
    observer?.observe(list);
    mutations.observe(list, { childList: true, characterData: true, subtree: true });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    document.fonts?.addEventListener("loadingdone", schedule);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) schedule();
    });

    return () => {
      active = false;
      cancelAnimationFrame(scheduled);
      cancelAnimationFrame(clearing);
      list.removeAttribute(INSTANT);
      observer?.disconnect();
      mutations.disconnect();
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [container, selectedKey, axis, level]);

  return setContainer;
}
