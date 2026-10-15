import { useEffect, useState, useSyncExternalStore } from "react";
import { getGrantStoreStatus, resetGrantStore } from "../../ipc/grants";
import {
  createGrantStoreController,
  type GrantStoreController,
  type GrantStoreNoticeState,
} from "./grantStoreController";

/** Reads the store status once at start-up; it never resets by itself. */
export function useGrantStoreNotice(): {
  controller: GrantStoreController;
  state: GrantStoreNoticeState;
} {
  const [controller] = useState(() =>
    createGrantStoreController({
      getStatus: getGrantStoreStatus,
      reset: resetGrantStore,
    }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  return { controller, state };
}
