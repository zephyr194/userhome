import { useCallback, useEffect, useRef, useState } from "react";
import { detectAiConfig } from "../../ipc/aiConfig";
import { decodeAppError } from "../../ipc/core";
import { AiConfigView } from "./AiConfigView";
import { CommandBuilder } from "./CommandBuilder";
import { ToolSettings } from "./ToolSettings";
import type { AiConfigState } from "./aiConfigModel";

/**
 * Runs the argument-free detection on mount and on retry. Only the newest
 * request may update the view, so an earlier slow response cannot replace a
 * later one. Nothing is stored in browser storage.
 */
export function AiConfigPage() {
  const [state, setState] = useState<AiConfigState>({ status: "loading" });
  const requestCounter = useRef(0);

  const request = useCallback(() => {
    const requestId = ++requestCounter.current;
    detectAiConfig().then(
      (report) => {
        if (requestId === requestCounter.current) setState({ status: "ready", report });
      },
      (error: unknown) => {
        if (requestId === requestCounter.current) {
          setState({ status: "failed", error: decodeAppError(error) });
        }
      },
    );
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    request();
  }, [request]);

  useEffect(() => {
    request();
  }, [request]);

  return (
    <AiConfigView
      state={state}
      onRetry={retry}
      claudePanel={
        <>
          <ToolSettings />
          <CommandBuilder />
        </>
      }
    />
  );
}
