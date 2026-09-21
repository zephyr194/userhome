import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const REFRESH_REQUESTED_EVENT = "userhome://refresh-requested";
export const SETTINGS_REQUESTED_EVENT = "userhome://settings-requested";

export type ListenForEvent = (
  eventName: string,
  handler: () => void,
) => Promise<UnlistenFn>;

const listenForEvent: ListenForEvent = (eventName, handler) =>
  listen(eventName, handler);

function registerRequestListener(
  eventName: string,
  onRequest: () => void,
  register: ListenForEvent,
): Promise<UnlistenFn> {
  return register(eventName, onRequest);
}

export function registerRefreshRequestListener(
  onRefresh: () => void,
  register: ListenForEvent = listenForEvent,
): Promise<UnlistenFn> {
  return registerRequestListener(REFRESH_REQUESTED_EVENT, onRefresh, register);
}

export function registerSettingsRequestListener(
  onOpenSettings: () => void,
  register: ListenForEvent = listenForEvent,
): Promise<UnlistenFn> {
  return registerRequestListener(
    SETTINGS_REQUESTED_EVENT,
    onOpenSettings,
    register,
  );
}
