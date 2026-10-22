import { useEffect, type RefObject } from "react";

/**
 * 结果出现后把结果区滚入可视范围，并把焦点移到结果标题。result 为 undefined
 * 表示还没有结果可显示，此时什么也不做。
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
