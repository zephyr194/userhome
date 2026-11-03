import { describe, expect, it } from "vitest";
import { deferred } from "./deferred";

describe("deferred", () => {
  it("stays pending until it is resolved", async () => {
    const gate = deferred<number>();
    let settled = false;
    void gate.promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve(3);
    await expect(gate.promise).resolves.toBe(3);
  });

  it("rejects with the given reason", async () => {
    const gate = deferred<number>();
    gate.reject(new Error("late failure"));
    await expect(gate.promise).rejects.toThrow("late failure");
  });

  it("keeps the first outcome when settled twice", async () => {
    const gate = deferred<string>();
    gate.resolve("first");
    gate.resolve("second");
    gate.reject(new Error("ignored"));
    await expect(gate.promise).resolves.toBe("first");
  });

  it("resolves without a value when no type is given", async () => {
    const gate = deferred();
    gate.resolve();
    await expect(gate.promise).resolves.toBeUndefined();
  });
});
