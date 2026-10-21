export interface RequestTracker {
  issue(): number;
  isCurrent(id: number): boolean;
  invalidate(): void;
}

// Only the newest request may update the view, so a slow older response can
// never overwrite the result of the draft the user is looking at now.
export function createRequestTracker(): RequestTracker {
  let latest = 0;
  return {
    issue() {
      latest += 1;
      return latest;
    },
    isCurrent(id) {
      return id === latest;
    },
    invalidate() {
      latest += 1;
    },
  };
}

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
