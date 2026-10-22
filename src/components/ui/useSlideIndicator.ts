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
 */
export function useSlideIndicator(selectedKey: unknown, axis: SlideAxis = "y") {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!container) return;
    container.setAttribute("data-slide-axis", axis);

    const measure = () => {
      const matches = container.querySelectorAll<HTMLElement>(SELECTED_ITEM);
      const selected = matches[matches.length - 1];
      if (!selected) {
        container.removeAttribute("data-slide-ready");
        return;
      }
      container.style.setProperty("--slide-x", `${selected.offsetLeft}px`);
      container.style.setProperty("--slide-y", `${selected.offsetTop}px`);
      container.style.setProperty("--slide-w", `${selected.offsetWidth}px`);
      container.style.setProperty("--slide-h", `${selected.offsetHeight}px`);
      container.setAttribute("data-slide-ready", "");
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
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
