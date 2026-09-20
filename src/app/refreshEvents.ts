import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const REFRESH_REQUESTED_EVENT = "userhome://refresh-requested";

export type ListenForEvent = (
  eventName: string,
  handler: () => void,
) => Promise<UnlistenFn>;

const listenForEvent: ListenForEvent = (eventName, handler) =>
  listen(eventName, handler);

export function registerRefreshRequestListener(
  onRefresh: () => void,
  register: ListenForEvent = listenForEvent,
): Promise<UnlistenFn> {
  return register(REFRESH_REQUESTED_EVENT, onRefresh);
}
