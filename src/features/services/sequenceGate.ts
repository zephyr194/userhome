/**
 * Keeps only the answer to the newest request. An earlier answer that arrives
 * late, after a newer request or a dismissed dialog, is dropped, never shown.
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
