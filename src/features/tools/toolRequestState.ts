export const MAX_INPUT_BYTES = 1024 * 1024;

export function exceedsInputLimit(text: string): boolean {
  return new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES;
}

/**
 * Issues request ids and reports whether a response still matches the latest
 * request. Invalidating (tool switch, clear, input edit) makes every in-flight
 * response stale so it can never be shown as the current result.
 */
export function createRequestTracker() {
  let latest = 0;
  return {
    issue(): number {
      latest += 1;
      return latest;
    },
    isCurrent(id: number): boolean {
      return id === latest;
    },
    invalidate(): void {
      latest += 1;
    },
  };
}
