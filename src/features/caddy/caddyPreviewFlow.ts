export interface Timers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface Debouncer {
  schedule(task: () => void): void;
  cancel(): void;
}

export function createDebouncer(delayMs: number, timers: Timers): Debouncer {
  let handle: unknown;
  return {
    schedule(task) {
      if (handle !== undefined) timers.clear(handle);
      handle = timers.set(() => {
        handle = undefined;
        task();
      }, delayMs);
    },
    cancel() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },
  };
}
