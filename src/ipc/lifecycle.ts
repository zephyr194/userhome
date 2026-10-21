import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createInternalError, invokeCommand, isRecord } from "./core";

export const QUIT_CONFIRMATION_EVENT = "userhome://quit-confirmation-requested";

export interface QuitConfirmationRequest {
  processCount: number;
  items?: string[];
}

export type QuitResult =
  | { status: "QUITTING"; stopped: number }
  | { status: "STOP_FAILED"; stopped: number; unconfirmed: string[] };

export type ListenForQuitConfirmation = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnlistenFn>;

const listenForEvent: ListenForQuitConfirmation = (eventName, handler) =>
  listen<unknown>(eventName, handler);

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function decodeQuitConfirmationRequest(
  value: unknown,
): QuitConfirmationRequest {
  if (!isRecord(value) || !isCount(value.processCount)) {
    throw createInternalError();
  }
  if (value.items === undefined) {
    return { processCount: value.processCount };
  }
  if (!isStringList(value.items)) {
    throw createInternalError();
  }
  return { processCount: value.processCount, items: value.items };
}

export function decodeQuitResult(value: unknown): QuitResult {
  if (!isRecord(value) || !isCount(value.stopped)) {
    throw createInternalError();
  }
  if (value.status === "QUITTING") {
    return { status: "QUITTING", stopped: value.stopped };
  }
  if (
    value.status === "STOP_FAILED" &&
    Array.isArray(value.unconfirmed) &&
    value.unconfirmed.every((label) => typeof label === "string")
  ) {
    return {
      status: "STOP_FAILED",
      stopped: value.stopped,
      unconfirmed: value.unconfirmed as string[],
    };
  }
  throw createInternalError();
}

/**
 * Listens for the backend asking whether to stop own processes and quit. A
 * malformed payload is ignored rather than shown as a question the backend did
 * not ask.
 */
export function registerQuitConfirmationListener(
  onRequest: (request: QuitConfirmationRequest) => void,
  register: ListenForQuitConfirmation = listenForEvent,
): Promise<UnlistenFn> {
  return register(QUIT_CONFIRMATION_EVENT, (event) => {
    try {
      onRequest(decodeQuitConfirmationRequest(event.payload));
    } catch {
      // Not a request this app understands.
    }
  });
}

/** "Stop and quit": the app exits only once every own process is confirmed gone. */
export function confirmQuit(): Promise<QuitResult> {
  return invokeCommand("confirm_quit", decodeQuitResult);
}

/** "Cancel quit": changes nothing but the pending prompt. */
export function cancelQuit(): Promise<void> {
  return invokeCommand("cancel_quit", () => undefined);
}
