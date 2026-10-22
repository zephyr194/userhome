export interface ScrollMemory {
  record(top: number): void;
  switchTo(key: string): number;
}

export function createScrollMemory(initialKey: string): ScrollMemory {
  let activeKey = initialKey;
  let top = 0;
  const saved = new Map<string, number>();
  return {
    record(next) {
      top = next;
    },
    switchTo(key) {
      if (key === activeKey) return top;
      saved.set(activeKey, top);
      activeKey = key;
      top = saved.get(key) ?? 0;
      return top;
    },
  };
}
