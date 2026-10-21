import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  QUIT_CONFIRMATION_EVENT,
  cancelQuit,
  confirmQuit,
  decodeQuitConfirmationRequest,
  decodeQuitResult,
  registerQuitConfirmationListener,
} from "./lifecycle";

describe("quit confirmation payload", () => {
  it("decodes the optional running items and keeps the bare count when none are sent", () => {
    expect(decodeQuitConfirmationRequest({ processCount: 1 })).toEqual({
      processCount: 1,
    });
    expect(
      decodeQuitConfirmationRequest({
        processCount: 1,
        items: ["Caddy 自有实例（监听 127.0.0.1:8080）"],
      }),
    ).toEqual({
      processCount: 1,
      items: ["Caddy 自有实例（监听 127.0.0.1:8080）"],
    });
    expect(() =>
      decodeQuitConfirmationRequest({ processCount: 1, items: [1] }),
    ).toThrow();
    expect(() =>
      decodeQuitConfirmationRequest({ processCount: 1, items: "caddy" }),
    ).toThrow();
  });
});

describe("lifecycle IPC", () => {
  it("confirms the quit with no arguments and decodes both outcomes", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("confirm_quit");
      expect(payload).toEqual({});
      return { status: "QUITTING", stopped: 2 };
    });
    await expect(confirmQuit()).resolves.toEqual({
      status: "QUITTING",
      stopped: 2,
    });

    expect(
      decodeQuitResult({ status: "STOP_FAILED", stopped: 1, unconfirmed: ["caddy"] }),
    ).toEqual({ status: "STOP_FAILED", stopped: 1, unconfirmed: ["caddy"] });
    expect(() => decodeQuitResult({ status: "OTHER", stopped: 0 })).toThrow();
    expect(() =>
      decodeQuitResult({ status: "STOP_FAILED", stopped: 0, unconfirmed: [1] }),
    ).toThrow();
  });

  it("cancels the quit through its own command", async () => {
    const commands: string[] = [];
    mockIPC((command) => {
      commands.push(command);
      return null;
    });
    await expect(cancelQuit()).resolves.toBeUndefined();
    expect(commands).toEqual(["cancel_quit"]);
  });

  it("decodes the confirmation event and ignores malformed payloads", async () => {
    let handler: (event: { payload: unknown }) => void = () => undefined;
    const register = vi.fn((eventName: string, next: typeof handler) => {
      expect(eventName).toBe(QUIT_CONFIRMATION_EVENT);
      handler = next;
      return Promise.resolve(() => undefined);
    });
    const onRequest = vi.fn();

    await registerQuitConfirmationListener(onRequest, register);
    handler({ payload: { processCount: 2 } });
    handler({ payload: { processCount: "2" } });
    handler({ payload: null });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith({ processCount: 2 });
  });
});
