import { useCallback, useEffect, useRef, useState } from "react";
import { detectAiConfig, lastAiConfigReport } from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import { AiConfigView } from "./AiConfigView";
import { CommandBuilder } from "./CommandBuilder";
import { ToolSettings } from "./ToolSettings";
import { useToolSearchIndex } from "./configSearchStore";
import { CLAUDE_CODE_TOOL_ID, type AiConfigState } from "./aiConfigModel";

interface PageState {
  view: AiConfigState;
  refreshing: boolean;
  refreshError?: AppError;
}

// In memory for this session only, so returning to the page keeps the tool the user picked.
let rememberedToolId = CLAUDE_CODE_TOOL_ID;
// Kept in memory only, like the detection cache, so it survives leaving and returning to the page.
let rememberedQuery = "";

function initialPageState(): PageState {
  const cached = lastAiConfigReport();
  return {
    view: cached ? { status: "ready", report: cached } : { status: "loading" },
    refreshing: false,
  };
}

/**
 * Shows the last detection at once on every visit. Detection runs again only
 * from the refresh action or a newer app-wide refresh, never on a plain remount. Only the newest request
 * may update the view.
 */
export function AiConfigPage({ refreshId }: { refreshId?: string }) {
  const [page, setPage] = useState<PageState>(initialPageState);
  const [selectedToolId, setSelectedToolId] = useState(rememberedToolId);
  const [query, setQuery] = useState(rememberedQuery);
  const searchIndex = useToolSearchIndex();
  const requestCounter = useRef(0);

  const detect = useCallback(() => {
    const requestId = ++requestCounter.current;
    detectAiConfig().then(
      (report) => {
        if (requestId === requestCounter.current) {
          setPage({ view: { status: "ready", report }, refreshing: false });
        }
      },
      (error: unknown) => {
        if (requestId !== requestCounter.current) return;
        const appError = decodeAppError(error);
        setPage((current) =>
          current.view.status === "ready"
            ? { view: current.view, refreshing: false, refreshError: appError }
            : { view: { status: "failed", error: appError }, refreshing: false },
        );
      },
    );
  }, []);

  const refresh = useCallback(() => {
    setPage((current) => ({
      view: current.view.status === "ready" ? current.view : { status: "loading" },
      refreshing: true,
      refreshError: undefined,
    }));
    detect();
  }, [detect]);

  useEffect(() => {
    if (lastAiConfigReport() === undefined) detect();
  }, [detect]);

  // A newer app-wide refresh re-detects; the first value seen on mount does not.
  const seenRefreshId = useRef(refreshId);
  useEffect(() => {
    if (seenRefreshId.current === refreshId) return;
    seenRefreshId.current = refreshId;
    refresh();
  }, [refreshId, refresh]);

  const selectTool = useCallback((toolId: string) => {
    rememberedToolId = toolId;
    setSelectedToolId(toolId);
  }, []);

  const changeQuery = useCallback((next: string) => {
    rememberedQuery = next;
    setQuery(next);
  }, []);

  return (
    <AiConfigView
      state={page.view}
      refreshing={page.refreshing}
      refreshError={page.refreshError}
      selectedToolId={selectedToolId}
      onSelectTool={selectTool}
      onRefresh={refresh}
      query={query}
      onQueryChange={changeQuery}
      searchIndex={searchIndex}
      claudePanel={
        <>
          <ToolSettings query={query} />
          <CommandBuilder />
        </>
      }
    />
  );
}
