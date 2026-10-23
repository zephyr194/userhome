import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeCommand } from "./core";

export const DEEP_LINK_EVENT = "deep-link://navigate";

export type ListenForDeepLink = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnlistenFn>;

const listenForEvent: ListenForDeepLink = (eventName, handler) =>
  listen<unknown>(eventName, handler);

/** Listens for a link opened while the app runs; the payload is re-validated before use. */
export function registerDeepLinkListener(
  onNavigate: (payload: unknown) => void,
  register: ListenForDeepLink = listenForEvent,
): Promise<UnlistenFn> {
  return register(DEEP_LINK_EVENT, (event) => onNavigate(event.payload));
}

/** Takes the link that opened the app before the window was ready; null when there is none. */
export function takePendingDeepLink(): Promise<unknown> {
  return invokeCommand("take_pending_deep_link", (value) => value);
}
