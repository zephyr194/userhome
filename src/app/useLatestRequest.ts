import { useEffect, useState } from "react";
import { createSequenceGate } from "./sequenceGate";

export interface LatestRequestHandlers<T> {
  onResult: (value: T) => void;
  onError?: (error: unknown) => void;
}

export interface LatestRequest {
  /**
   * Starts a request. Its answer reaches the handlers only while it is still
   * the newest one: a later `run`, a `cancel` or an unmount drops it, whether
   * it resolves or rejects, so a late answer never overwrites newer state.
   */
  run<T>(start: () => Promise<T>, handlers: LatestRequestHandlers<T>): void;
  /** Drops the answer of every request still running. */
  cancel(): void;
}

/**
 * The one way a component binds a backend answer to the request that asked for
 * it. It is the sequence gate the dialogs already use, tied to the component's
 * lifetime: the unmount cleanup cancels, and StrictMode's extra cleanup does
 * the same without breaking the remount, because a cancel only invalidates the
 * requests issued so far. One instance covers one stream of requests; a
 * component with independent streams calls the hook once per stream.
 */
export function useLatestRequest(): LatestRequest {
  const [gate] = useState(createSequenceGate);
  const [request] = useState<LatestRequest>(() => {
    function run<T>(
      start: () => Promise<T>,
      { onResult, onError }: LatestRequestHandlers<T>,
    ) {
      const sequence = gate.next();
      let pending: Promise<T>;
      try {
        pending = start();
      } catch (error) {
        pending = Promise.reject(error);
      }
      void pending.then(
        (value) => {
          if (gate.isCurrent(sequence)) onResult(value);
        },
        (error: unknown) => {
          if (gate.isCurrent(sequence)) onError?.(error);
        },
      );
    }
    return { run, cancel: () => gate.cancel() };
  });

  useEffect(() => () => gate.cancel(), [gate]);

  return request;
}
