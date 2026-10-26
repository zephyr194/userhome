import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./singleFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleFlight", () => {
  it("shares one in-flight call between overlapping callers", async () => {
    const gate = deferred<number>();
    const start = vi.fn(() => gate.promise);
    const run = singleFlight(start);

    const first = run();
    const second = run();

    expect(second).toBe(first);
    expect(start).toHaveBeenCalledTimes(1);
    gate.resolve(7);
    await expect(first).resolves.toBe(7);
    await expect(second).resolves.toBe(7);
  });

  it("starts a new call after a failed one settles", async () => {
    const failing = deferred<number>();
    const retry = deferred<number>();
    const start = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(retry.promise);
    const run = singleFlight(start);

    const first = run();
    failing.reject(new Error("boom"));
    await expect(first).rejects.toThrow("boom");

    const second = run();
    expect(start).toHaveBeenCalledTimes(2);
    retry.resolve(2);
    await expect(second).resolves.toBe(2);
  });

  it("starts a new call after a successful one settles", async () => {
    const start = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    const run = singleFlight(start);

    const first = run();
    await expect(first).resolves.toBe(1);

    const second = run();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBe(2);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
