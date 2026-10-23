import { useLayoutEffect, useState } from "react";

export type SlideAxis = "x" | "y";

const SELECTED_ITEM = [
  ".slide-item[aria-current=\"true\"]",
  ".slide-item[aria-current=\"page\"]",
  ".slide-item[aria-selected=\"true\"]",
  ".slide-item[data-selected=\"true\"]",
].join(",");

/**
 * Positions the sliding selection indicator of a `.slide-list` container.
 * The container must be the offsetParent of its items (`position: relative`).
 * Nested selections (a route and one of its sections) resolve to the innermost
 * one, which is the last match in document order. The returned callback ref
 * re-measures when a conditionally rendered list mounts.
 *
 * Once measured, the container keeps its last position: losing the selection
 * only hides the indicator, so the next selection slides from where it was.
 * A subtree that is not laid out (hidden) keeps the previous position and is
 * measured again when the container resizes.
 */
export function useSlideIndicator(selectedKey: unknown, axis: SlideAxis = "y") {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!container) return;
    const list = container;
    list.setAttribute("data-slide-axis", axis);

    let watched: HTMLElement | null = null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);

    function measure() {
      const matches = list.querySelectorAll<HTMLElement>(SELECTED_ITEM);
      const selected = matches[matches.length - 1];
      if (!selected) {
        list.setAttribute("data-slide-empty", "");
        return;
      }
      if (selected.offsetWidth === 0 && selected.offsetHeight === 0) return;
      list.style.setProperty("--slide-x", `${selected.offsetLeft}px`);
      list.style.setProperty("--slide-y", `${selected.offsetTop}px`);
      list.style.setProperty("--slide-w", `${selected.offsetWidth}px`);
      list.style.setProperty("--slide-h", `${selected.offsetHeight}px`);
      list.removeAttribute("data-slide-empty");
      list.setAttribute("data-slide-ready", "");
      if (observer && watched !== selected) {
        if (watched) observer.unobserve(watched);
        observer.observe(selected);
        watched = selected;
      }
    }

    measure();
    observer?.observe(list);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) measure();
    });

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [container, selectedKey, axis]);

  return setContainer;
}
