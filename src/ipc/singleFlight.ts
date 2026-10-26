/**
 * Overlapping calls share the promise already in flight. Once it settles, whether
 * it resolved or rejected, the next call starts a new one.
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
