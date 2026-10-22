import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import { readLaunchctlEnvironment, revealLaunchctlValue } from "../../ipc/environment";
import { LaunchctlView, type LaunchctlState } from "./LaunchctlView";

/**
 * Reads the login session variables when the section is first opened, then
 * stays mounted. Nothing is stored in the browser: the list and any revealed
 * secret live only in component state, and a re-read drops them.
 */
export function LaunchctlPage() {
  const [state, setState] = useState<LaunchctlState>({ status: "loading" });
  const requestCounter = useRef(0);

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

  return <LaunchctlView onReveal={reveal} onRetry={retry} state={state} />;
}
