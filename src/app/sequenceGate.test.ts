import { describe, expect, it } from "vitest";
import { createRequestTracker, createSequenceGate } from "./sequenceGate";

describe("sequence gate", () => {
  it("accepts only the newest request", () => {
    const gate = createSequenceGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("drops every outstanding answer once cancelled", () => {
    const gate = createSequenceGate();
    const pending = gate.next();
    gate.cancel();
    expect(gate.isCurrent(pending)).toBe(false);
    expect(gate.isCurrent(gate.next())).toBe(true);
  });

  it("starts with nothing current", () => {
    expect(createSequenceGate().isCurrent(0)).toBe(false);
  });
});

describe("request tracker", () => {
  it("treats only the most recently issued request as current", () => {
    const tracker = createRequestTracker();
    const first = tracker.issue();
    const second = tracker.issue();
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it("makes every in-flight request stale after invalidation", () => {
    const tracker = createRequestTracker();
    const pending = tracker.issue();
    tracker.invalidate();
    expect(tracker.isCurrent(pending)).toBe(false);
    expect(tracker.isCurrent(tracker.issue())).toBe(true);
  });

  it("keeps independent trackers independent", () => {
    const a = createRequestTracker();
    const b = createRequestTracker();
    const first = a.issue();
    b.issue();
    b.issue();
    expect(a.isCurrent(first)).toBe(true);
  });
});
