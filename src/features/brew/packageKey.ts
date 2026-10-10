import type { KeyboardEvent } from "react";
import type { BrewSearchResult } from "../../ipc/brew";

export function packageKey(selection: BrewSearchResult): string {
  return `${selection.kind}:${selection.identifier}`;
}

export function targetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  itemCount: number,
): number | undefined {
  if (event.key === "ArrowDown") return Math.min(currentIndex + 1, itemCount - 1);
  if (event.key === "ArrowUp") return Math.max(currentIndex - 1, 0);
  if (event.key === "Home") return 0;
  if (event.key === "End") return itemCount - 1;
  return undefined;
}
