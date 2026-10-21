import { describe, expect, it } from "vitest";
import { createDebouncer, createRequestTracker, type Timers } from "./caddyPreviewFlow";

function fakeTimers() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const timers: Timers = {
    set(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    pendingCount: () => pending.size,
    fireAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

describe("request tracker", () => {
  it("accepts only the most recently issued request", () => {
    const tracker = createRequestTracker();

    const first = tracker.issue();
    const second = tracker.issue();

    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it("discards every outstanding response after invalidation", () => {
    const tracker = createRequestTracker();
    const pending = tracker.issue();

    tracker.invalidate();

    expect(tracker.isCurrent(pending)).toBe(false);
  });
});

describe("debouncer", () => {
  it("runs only the last task scheduled inside the window", () => {
    const clock = fakeTimers();
    const debounced = createDebouncer(250, clock.timers);
    const ran: string[] = [];

    debounced.schedule(() => ran.push("a"));
    debounced.schedule(() => ran.push("b"));
    debounced.schedule(() => ran.push("c"));
    expect(clock.pendingCount()).toBe(1);
    clock.fireAll();

    expect(ran).toEqual(["c"]);
  });

  it("does not run a task that was cancelled before the window ended", () => {
    const clock = fakeTimers();
    const debounced = createDebouncer(250, clock.timers);
    const ran: string[] = [];

    debounced.schedule(() => ran.push("a"));
    debounced.cancel();
    clock.fireAll();

    expect(ran).toEqual([]);
    expect(clock.pendingCount()).toBe(0);
  });
});
