import { useSyncExternalStore } from "react";
import type { SearchItem } from "./configSearch";

export type ToolSearchIndex = ReadonlyMap<string, readonly SearchItem[]>;

// Only tools whose data has been loaded in this session appear here; the search never fetches.
let index: ToolSearchIndex = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ToolSearchIndex {
  return index;
}

export function publishToolSearchItems(toolId: string, items: readonly SearchItem[]): void {
  index = new Map(index).set(toolId, items);
  for (const listener of listeners) listener();
}

export function useToolSearchIndex(): ToolSearchIndex {
  return useSyncExternalStore(subscribe, snapshot);
}
