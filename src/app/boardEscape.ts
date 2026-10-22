import { useEffect } from "react";

const ESCAPE_OWNING_TARGETS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [aria-expanded="true"]';

export interface BoardEscapeTarget {
  matches(selector: string): boolean;
}

export interface BoardEscapeEvent {
  key: string;
  defaultPrevented: boolean;
  target: BoardEscapeTarget | null;
}

export function shouldExitBoardOnEscape(
  event: BoardEscapeEvent,
  dialogOpen: boolean,
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || dialogOpen) {
    return false;
  }
  return !event.target?.matches(ESCAPE_OWNING_TARGETS);
}

export function useBoardEscape(active: boolean, exit: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogOpen =
        document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
      const target = event.target instanceof Element ? event.target : null;
      if (
        shouldExitBoardOnEscape(
          { key: event.key, defaultPrevented: event.defaultPrevented, target },
          dialogOpen,
        )
      ) {
        exit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, exit]);
}
