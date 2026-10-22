import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import { TERMINAL_IDLE, reduceTerminalOpen, type TerminalOpenState } from "./terminalOpenModel";

const ERROR: AppError = { code: "PROCESS_FAILED", message: "无法在 Terminal 中打开命令。", retryable: true } as AppError;

describe("reduceTerminalOpen", () => {
  it("moves from request to confirmation to opened, in that order", () => {
    let state = reduceTerminalOpen(TERMINAL_IDLE, { type: "request" });
    expect(state).toEqual({ status: "confirming" });
    state = reduceTerminalOpen(state, { type: "confirm" });
    expect(state).toEqual({ status: "opening" });
    state = reduceTerminalOpen(state, { type: "succeeded" });
    expect(state).toEqual({ status: "opened" });
  });

  it("only leaves the confirmation step through an explicit confirm or cancel", () => {
    const confirming = reduceTerminalOpen(TERMINAL_IDLE, { type: "request" });
    expect(reduceTerminalOpen(confirming, { type: "cancel" })).toEqual(TERMINAL_IDLE);
    expect(reduceTerminalOpen(confirming, { type: "succeeded" })).toEqual(confirming);
    expect(reduceTerminalOpen(TERMINAL_IDLE, { type: "confirm" })).toEqual(TERMINAL_IDLE);
  });

  it("keeps the failure and lets the user request again", () => {
    const opening: TerminalOpenState = { status: "opening" };
    const failed = reduceTerminalOpen(opening, { type: "failed", error: ERROR });
    expect(failed).toEqual({ status: "failed", error: ERROR });
    expect(reduceTerminalOpen(failed, { type: "request" })).toEqual({ status: "confirming" });
  });

  it("ignores cancel, request and settlement while an open is in flight", () => {
    const opening: TerminalOpenState = { status: "opening" };
    expect(reduceTerminalOpen(opening, { type: "cancel" })).toEqual(opening);
    expect(reduceTerminalOpen(opening, { type: "request" })).toEqual(opening);
    expect(reduceTerminalOpen(opening, { type: "confirm" })).toEqual(opening);
  });

  it("does not reopen after success", () => {
    const opened: TerminalOpenState = { status: "opened" };
    expect(reduceTerminalOpen(opened, { type: "confirm" })).toEqual(opened);
    expect(reduceTerminalOpen(opened, { type: "succeeded" })).toEqual(opened);
  });
});
