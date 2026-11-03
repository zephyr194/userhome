/**
 * Keeps only the answer to the newest request ("latest wins"): an earlier
 * answer that arrives late, after a newer request or a dismissed dialog, is
 * dropped, never shown. Every request still runs; only the stale answers are
 * ignored. A component binds it to its lifetime through `useLatestRequest`.
 *
 * To make overlapping callers share one in-flight request instead (the second
 * caller gets the first one's promise, nothing runs twice), use `singleFlight`
 * in `src/ipc/singleFlight.ts`. The two are not interchangeable: here the
 * newest request wins, there the oldest in-flight one is reused.
 */
export interface SequenceGate {
  next(): number;
  isCurrent(sequence: number): boolean;
  /** Invalidates every request issued so far. */
  cancel(): void;
}

export function createSequenceGate(): SequenceGate {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isCurrent(sequence) {
      return latest > 0 && sequence === latest;
    },
    cancel() {
      latest += 1;
    },
  };
}

/**
 * The same gate under the names the tool and Caddy pages use: `issue` starts a
 * request, `isCurrent` asks whether its response is still the newest, and
 * `invalidate` (tool switch, clear, input edit) makes every in-flight response
 * stale so it can never be shown as the current result.
 */
export interface RequestTracker {
  issue(): number;
  isCurrent(id: number): boolean;
  invalidate(): void;
}

export function createRequestTracker(): RequestTracker {
  const gate = createSequenceGate();
  return {
    issue: gate.next,
    isCurrent: gate.isCurrent,
    invalidate: gate.cancel,
  };
}
