import { describe, expect, it, vi } from "vitest";

import { createRefreshCoordinator } from "./refreshCoordinator";

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

    const initial = refresh(false);
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    expect(run).toHaveBeenNthCalledWith(1, false);

    let forcedCompleted = false;
    const forced = refresh(true).then(() => {
      forcedCompleted = true;
    });
    await Promise.resolve();
    expect(forcedCompleted).toBe(false);

    completions[0]();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    expect(run).toHaveBeenNthCalledWith(2, true);
    expect(forcedCompleted).toBe(false);

    completions[1]();
    await Promise.all([initial, forced]);
    expect(forcedCompleted).toBe(true);
  });
});
