import { describe, expect, it, vi } from "vitest";
import { createRefreshCoordinator } from "./App";

describe("createRefreshCoordinator", () => {
  it("queues a forced refresh received during an active refresh", async () => {
    const completions: Array<() => void> = [];
    const run = vi.fn(
      (refreshProviders: boolean) =>
        new Promise<void>((resolve) => {
          void refreshProviders;
          completions.push(resolve);
        }),
    );
    const refresh = createRefreshCoordinator(run);

    const first = refresh(false);
    const forced = refresh(true);

    expect(run.mock.calls).toEqual([[false]]);
    completions.shift()?.();
    await vi.waitFor(() => {
      expect(run.mock.calls).toEqual([[false], [true]]);
    });

    let forcedFinished = false;
    void forced.then(() => {
      forcedFinished = true;
    });
    await Promise.resolve();
    expect(forcedFinished).toBe(false);

    completions.shift()?.();
    await Promise.all([first, forced]);
    expect(forcedFinished).toBe(true);
  });
});
