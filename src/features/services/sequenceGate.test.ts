import { describe, expect, it } from "vitest";
import { createSequenceGate } from "./sequenceGate";

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
