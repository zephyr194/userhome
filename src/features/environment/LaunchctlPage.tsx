import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import {
  previewLaunchctlSet,
  readLaunchctlEnvironment,
  revealLaunchctlValue,
  setLaunchctlValue,
  unsetLaunchctlValue,
  type LaunchctlChange,
  type LaunchctlEnvironment,
} from "../../ipc/environment";
import type { LaunchctlSetInput } from "./LaunchctlDialogs";
import { LaunchctlView, type LaunchctlState } from "./LaunchctlView";

/**
 * Reads the login session variables when the section is first opened, then
 * stays mounted. Nothing is stored in the browser: the list and any revealed
 * secret live only in component state, and a re-read drops them. A change
 * replaces the list with the result it returns, without a loading state.
 */
export function LaunchctlPage() {
  const [state, setState] = useState<LaunchctlState>({ status: "loading" });
  const requestCounter = useRef(0);

  const applyChange = useCallback((change: LaunchctlChange) => {
    requestCounter.current += 1;
    const environment: LaunchctlEnvironment = {
      entries: change.entries,
      readAt: change.readAt,
      partial: change.partial,
    };
    setState({ status: "ready", environment });
  }, []);

  const read = useCallback(() => {
    const requestId = ++requestCounter.current;
    readLaunchctlEnvironment().then(
      (environment) => {
        if (requestId === requestCounter.current) {
          setState({ status: "ready", environment });
        }
      },
      (error: unknown) => {
        if (requestId === requestCounter.current) {
          setState({ status: "failed", message: decodeAppError(error).message });
        }
      },
    );
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    read();
  }, [read]);

  useEffect(() => {
    read();
  }, [read]);

  const reveal = useCallback((key: string) => revealLaunchctlValue(key), []);
  const preview = useCallback((key: string, value: string) => previewLaunchctlSet(key, value), []);
  const set = useCallback(
    async (input: LaunchctlSetInput) => {
      const change = await setLaunchctlValue(input);
      applyChange(change);
      return change;
    },
    [applyChange],
  );
  const unset = useCallback(
    async (key: string, expectedCurrent: string | null) => {
      const change = await unsetLaunchctlValue({ key, expectedCurrent });
      applyChange(change);
      return change;
    },
    [applyChange],
  );

  return (
    <LaunchctlView
      onPreview={preview}
      onReveal={reveal}
      onRetry={retry}
      onSet={set}
      onUnset={unset}
      state={state}
    />
  );
}
