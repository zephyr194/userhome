import { describe, expect, it, vi } from "vitest";
import {
  REFRESH_REQUESTED_EVENT,
  registerRefreshRequestListener,
  type ListenForEvent,
} from "./refreshEvents";

describe("registerRefreshRequestListener", () => {
  it("registers one listener, reloads once per event, and releases it", async () => {
    const unlisten = vi.fn();
    const onRefresh = vi.fn();
    let handler: (() => void) | undefined;
    const listenForEvent: ListenForEvent = vi.fn(
      async (_eventName, eventHandler) => {
        handler = eventHandler;
        return unlisten;
      },
    );

    const cleanup = await registerRefreshRequestListener(
      onRefresh,
      listenForEvent,
    );
    handler?.();
    cleanup();

    expect(listenForEvent).toHaveBeenCalledTimes(1);
    expect(listenForEvent).toHaveBeenCalledWith(
      REFRESH_REQUESTED_EVENT,
      expect.any(Function),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
