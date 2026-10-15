import { describe, expect, it, vi } from "vitest";
import type { GrantStoreReset, GrantStoreStatus } from "../../ipc/grants";
import {
  createGrantStoreController,
  type GrantStoreController,
} from "./grantStoreController";

const AVAILABLE: GrantStoreStatus = { status: "AVAILABLE" };
const CORRUPT: GrantStoreStatus = { status: "UNAVAILABLE", reason: "CORRUPT" };
const RESET_RESULT: GrantStoreReset = {
  quarantineFileName: "grants.json.corrupt-20261015T133000Z",
  previousReason: "CORRUPT",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(statuses: Array<GrantStoreStatus | Error>) {
  const queue = [...statuses];
  const getStatus = vi.fn(async () => {
    const next = queue.shift() ?? AVAILABLE;
    if (next instanceof Error) throw next;
    return next;
  });
  const reset = vi.fn<() => Promise<GrantStoreReset>>(async () => RESET_RESULT);
  const controller = createGrantStoreController({ getStatus, reset });
  return { controller, getStatus, reset };
}

async function unavailable(controller: GrantStoreController) {
  await controller.refresh();
  controller.openDialog();
}

describe("grant store controller", () => {
  it("starts silent and reads the status only when asked", async () => {
    const { controller, getStatus } = setup([AVAILABLE]);
    expect(controller.getState().check).toEqual({ phase: "checking" });
    expect(getStatus).not.toHaveBeenCalled();

    await controller.refresh();

    expect(controller.getState().check).toEqual({ phase: "available" });
    expect(controller.getState().dialog).toEqual({ phase: "closed" });
  });

  it("never resets on its own, even when the store is unavailable", async () => {
    const { controller, reset } = setup([CORRUPT]);

    await controller.refresh();

    expect(controller.getState().check).toEqual({
      phase: "unavailable",
      reason: "CORRUPT",
    });
    expect(reset).not.toHaveBeenCalled();
  });

  it("reports a failed status read instead of pretending the store is fine", async () => {
    const { controller } = setup([new Error("decode")]);

    await controller.refresh();

    expect(controller.getState().check).toEqual({ phase: "check-failed" });
  });

  it("recovers from a failed read on re-check", async () => {
    const { controller } = setup([new Error("decode"), AVAILABLE]);
    await controller.refresh();
    await controller.refresh();
    expect(controller.getState().check).toEqual({ phase: "available" });
  });

  it("marks a re-check in flight and keeps the previous result meanwhile", async () => {
    const pending = deferred<GrantStoreStatus>();
    const getStatus = vi
      .fn<() => Promise<GrantStoreStatus>>()
      .mockResolvedValueOnce(CORRUPT)
      .mockReturnValueOnce(pending.promise);
    const controller = createGrantStoreController({
      getStatus,
      reset: vi.fn(),
    });
    await controller.refresh();

    const recheck = controller.refresh();
    expect(controller.getState().rechecking).toBe(true);
    expect(controller.getState().check).toMatchObject({ phase: "unavailable" });
    pending.resolve(AVAILABLE);
    await recheck;

    expect(controller.getState().rechecking).toBe(false);
    expect(controller.getState().check).toEqual({ phase: "available" });
  });

  it("ignores a stale status answer that lands after a newer one", async () => {
    const first = deferred<GrantStoreStatus>();
    const second = deferred<GrantStoreStatus>();
    const getStatus = vi
      .fn<() => Promise<GrantStoreStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createGrantStoreController({
      getStatus,
      reset: vi.fn(),
    });

    const a = controller.refresh();
    const b = controller.refresh();
    second.resolve(AVAILABLE);
    await b;
    first.resolve(CORRUPT);
    await a;

    expect(controller.getState().check).toEqual({ phase: "available" });
  });

  it("opens the confirmation only for a resettable problem", async () => {
    for (const reason of ["NOT_REGULAR_FILE", "IO"] as const) {
      const { controller } = setup([{ status: "UNAVAILABLE", reason }]);
      await controller.refresh();
      controller.openDialog();
      expect(controller.getState().dialog).toEqual({ phase: "closed" });
    }
    const available = setup([AVAILABLE]);
    await available.controller.refresh();
    available.controller.openDialog();
    expect(available.controller.getState().dialog).toEqual({ phase: "closed" });

    for (const reason of ["CORRUPT", "NEWER_VERSION"] as const) {
      const { controller } = setup([{ status: "UNAVAILABLE", reason }]);
      await unavailable(controller);
      expect(controller.getState().dialog).toEqual({ phase: "asking" });
    }
  });

  it("cancel closes the confirmation without resetting or changing the status", async () => {
    const { controller, reset, getStatus } = setup([CORRUPT]);
    await unavailable(controller);

    controller.closeDialog();

    expect(reset).not.toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      check: { phase: "unavailable", reason: "CORRUPT" },
      dialog: { phase: "closed" },
    });
    expect(controller.getState().completed).toBeUndefined();
  });

  it("confirm without an open confirmation does nothing", async () => {
    const { controller, reset } = setup([CORRUPT]);
    await controller.refresh();

    await controller.confirmReset();

    expect(reset).not.toHaveBeenCalled();
  });

  it("confirm calls the reset once, blocks re-entry and cannot be closed meanwhile", async () => {
    const pending = deferred<GrantStoreReset>();
    const { controller, reset } = setup([CORRUPT]);
    reset.mockReturnValueOnce(pending.promise);
    await unavailable(controller);

    const running = controller.confirmReset();
    expect(controller.getState().dialog).toEqual({ phase: "resetting" });
    void controller.confirmReset();
    controller.closeDialog();
    expect(controller.getState().dialog).toEqual({ phase: "resetting" });
    expect(reset).toHaveBeenCalledTimes(1);

    pending.resolve(RESET_RESULT);
    await running;
  });

  it("on success refreshes the status, closes the prompt and records the quarantine name", async () => {
    const { controller, getStatus } = setup([CORRUPT, AVAILABLE]);
    await unavailable(controller);

    await controller.confirmReset();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      check: { phase: "available" },
      dialog: { phase: "closed" },
      completed: RESET_RESULT,
    });
  });

  it("dismisses the completion note", async () => {
    const { controller } = setup([CORRUPT, AVAILABLE]);
    await unavailable(controller);
    await controller.confirmReset();

    controller.dismissCompleted();

    expect(controller.getState().completed).toBeUndefined();
  });

  it("shows a refused reset truthfully, keeps the dialog open and the store untouched", async () => {
    const { controller, reset, getStatus } = setup([CORRUPT]);
    reset.mockRejectedValueOnce({
      code: "PERMISSION_DENIED",
      message: "could not be isolated",
      retryable: false,
    });
    await unavailable(controller);

    await controller.confirmReset();

    expect(controller.getState().dialog).toEqual({
      phase: "failed",
      failure: { code: "PERMISSION_DENIED", message: "could not be isolated" },
    });
    expect(controller.getState().completed).toBeUndefined();
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the quarantine file name in a partial failure", async () => {
    const { controller, reset } = setup([CORRUPT]);
    reset.mockRejectedValueOnce({
      code: "PARTIAL_FAILURE",
      message: "set aside as grants.json.corrupt-20261015T133000Z, try again",
      retryable: true,
    });
    await unavailable(controller);

    await controller.confirmReset();

    expect(controller.getState().dialog).toMatchObject({
      phase: "failed",
      failure: {
        code: "PARTIAL_FAILURE",
        message: expect.stringContaining("grants.json.corrupt-20261015T133000Z"),
      },
    });
  });

  it("treats a malformed reset answer as an unconfirmed failure", async () => {
    const { controller, reset } = setup([CORRUPT]);
    reset.mockRejectedValueOnce(new Error("not an AppError"));
    await unavailable(controller);

    await controller.confirmReset();

    expect(controller.getState().dialog).toMatchObject({
      phase: "failed",
      failure: { code: "INTERNAL" },
    });
  });

  it("re-checks when a failed confirmation is closed, since the store may have changed", async () => {
    const { controller, reset, getStatus } = setup([CORRUPT, AVAILABLE]);
    reset.mockRejectedValueOnce({
      code: "PARTIAL_FAILURE",
      message: "set aside",
      retryable: true,
    });
    await unavailable(controller);
    await controller.confirmReset();

    controller.closeDialog();
    await vi.waitFor(() =>
      expect(controller.getState().check).toEqual({ phase: "available" }),
    );

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(controller.getState().dialog).toEqual({ phase: "closed" });
  });

  it("allows retrying from a failed confirmation", async () => {
    const { controller, reset } = setup([CORRUPT, AVAILABLE]);
    reset.mockRejectedValueOnce({
      code: "PERMISSION_DENIED",
      message: "nothing changed",
      retryable: false,
    });
    await unavailable(controller);
    await controller.confirmReset();

    await controller.confirmReset();

    expect(reset).toHaveBeenCalledTimes(2);
    expect(controller.getState().completed).toEqual(RESET_RESULT);
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const { controller } = setup([CORRUPT]);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    await controller.refresh();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    controller.openDialog();
    expect(listener).not.toHaveBeenCalled();
  });
});
