import { useEffect, type RefObject } from "react";

/**
 * Scrolls the result into view and moves focus to its heading once a result
 * appears. An undefined result means there is nothing to show yet, so it does nothing.
 */
export function useRevealResult(
  result: unknown,
  sectionRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLHeadingElement | null>,
) {
  useEffect(() => {
    if (result === undefined) return;
    sectionRef.current?.scrollIntoView({ block: "nearest" });
    titleRef.current?.focus({ preventScroll: true });
  }, [result, sectionRef, titleRef]);
}
