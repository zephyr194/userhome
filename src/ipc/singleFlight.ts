/**
 * Overlapping calls share the promise already in flight (de-duplication): the
 * second caller gets the first one's promise and nothing runs twice. Once it
 * settles, whether it resolved or rejected, the next call starts a new one.
 *
 * Use it for idempotent reads that several callers may start at once, such as a
 * list the page and the data hub both load. It is not a latest-wins guard: it
 * never drops an answer. To keep only the answer of the newest request, use
 * `createSequenceGate` / `useLatestRequest` in `src/app/`.
 */
export function singleFlight<T>(start: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending === undefined) {
      const request: Promise<T> = start().finally(() => {
        if (pending === request) pending = undefined;
      });
      pending = request;
    }
    return pending;
  };
}
