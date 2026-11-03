// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../test/deferred";
import { renderStrict } from "../../test/renderStrict";
import { useLatestRequest } from "./useLatestRequest";

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

describe("useLatestRequest", () => {
  it("hands the answer of the only request to onResult", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const onResult = vi.fn();
    result.current.run(() => Promise.resolve(7), { onResult });
    await settle();
    expect(onResult).toHaveBeenCalledWith(7);
  });

  it("drops an older answer that arrives after a newer request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = deferred<string>();
    const second = deferred<string>();
    const onResult = vi.fn();
    result.current.run(() => first.promise, { onResult });
    result.current.run(() => second.promise, { onResult });

    second.resolve("new");
    await settle();
    first.resolve("old");
    await settle();

    expect(onResult.mock.calls).toEqual([["new"]]);
  });

  it("drops an older failure that arrives after a newer request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = deferred<string>();
    const onError = vi.fn();
    result.current.run(() => first.promise, { onResult: vi.fn(), onError });
    result.current.run(() => Promise.resolve("new"), { onResult: vi.fn(), onError });

    first.reject(new Error("old failure"));
    await settle();

    expect(onError).not.toHaveBeenCalled();
  });

  it("reports the failure of the newest request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const onError = vi.fn();
    const failure = new Error("boom");
    result.current.run(() => Promise.reject(failure), {
      onResult: vi.fn(),
      onError,
    });
    await settle();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("turns a synchronous throw into a failure of that request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const onError = vi.fn();
    const failure = new Error("invalid input");
    result.current.run(
      () => {
        throw failure;
      },
      { onResult: vi.fn(), onError },
    );
    await settle();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("drops the answer once cancelled and accepts the next request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const pending = deferred<string>();
    const onResult = vi.fn();
    result.current.run(() => pending.promise, { onResult });
    result.current.cancel();
    pending.resolve("cancelled");
    await settle();
    expect(onResult).not.toHaveBeenCalled();

    result.current.run(() => Promise.resolve("next"), { onResult });
    await settle();
    expect(onResult).toHaveBeenCalledWith("next");
  });

  it("sets no state after unmount", async () => {
    const pending = deferred<string>();
    const seen = vi.fn();
    function Probe() {
      const latest = useLatestRequest();
      return (
        <button
          type="button"
          onClick={() => latest.run(() => pending.promise, { onResult: seen })}
        >
          go
        </button>
      );
    }
    const view = render(<Probe />);
    fireEvent.click(view.getByText("go"));
    view.unmount();
    pending.resolve("after unmount");
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps an effect-started request alive across StrictMode's double mount", async () => {
    const calls: string[] = [];
    const answer = deferred<string>();
    const seen = vi.fn();
    function Probe() {
      const latest = useLatestRequest();
      useEffect(() => {
        calls.push("start");
        latest.run(() => answer.promise, { onResult: seen });
      }, [latest]);
      return null;
    }
    renderStrict(<Probe />);
    // Two effect runs started two requests; only the second one may answer.
    expect(calls).toEqual(["start", "start"]);
    answer.resolve("ready");
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("ready");
  });
});
