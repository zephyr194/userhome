import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Button } from "./Button";
import { classNames } from "./classNames";
import { TextField } from "./forms";
import {
  DEFAULT_LOG_MAX_LINES,
  INITIAL_LOG_VIEW_STATE,
  boundLines,
  currentLogView,
  filterLogLines,
  formatLinesForCopy,
  isNearBottom,
  normalizeMaxLines,
  pauseLogView,
  pendingLineCount,
  resumeLogView,
  setLogQuery,
  type LogViewState,
} from "./logBuffer";

type CopyFeedback = "idle" | "copied" | "failed";

export interface LogViewerProps {
  className?: string;
  /** 来源已丢弃的更早行数（例如后端有界日志的截断计数）。 */
  droppedCount?: number;
  emptyText?: string;
  /** 日志区域的可访问名称，例如“Caddy 日志”。 */
  label: string;
  /** 来源行；调用方不得原地修改该数组。 */
  lines: readonly string[];
  /** 展示行数上限，超出时丢弃最旧行并显示截断提示。 */
  maxLines?: number;
}

export function LogViewer({
  className,
  droppedCount = 0,
  emptyText = "暂无日志",
  label,
  lines,
  maxLines = DEFAULT_LOG_MAX_LINES,
}: LogViewerProps) {
  const limit = normalizeMaxLines(maxLines);
  const live = useMemo(
    () => boundLines({ lines, droppedCount }, limit),
    [lines, droppedCount, limit],
  );
  const [state, setState] = useState<LogViewState>(INITIAL_LOG_VIEW_STATE);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>("idle");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const view = currentLogView(state, live);
  const visibleLines = useMemo(
    () => filterLogLines(view.lines, state.query),
    [view.lines, state.query],
  );
  const pending = pendingLineCount(state, live);
  const filtering = state.query !== "";

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && !state.paused && stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [visibleLines, state.paused]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    stickToBottomRef.current = isNearBottom(
      scrollTop,
      clientHeight,
      scrollHeight,
    );
  }, []);

  const togglePause = () => {
    setCopyFeedback("idle");
    setState((previous) =>
      previous.paused ? resumeLogView(previous) : pauseLogView(previous, live),
    );
  };

  const copyVisible = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(formatLinesForCopy(visibleLines));
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    }
  };

  return (
    <section
      aria-label={label}
      className={classNames("grid min-w-0 gap-ui-md", className)}
    >
      <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
        <TextField
          autoComplete="off"
          className="min-w-48 flex-1"
          label="筛选日志"
          spellCheck={false}
          type="search"
          value={state.query}
          onValueChange={(query) => {
            setCopyFeedback("idle");
            setState((previous) => setLogQuery(previous, query));
          }}
        />
        <Button onClick={togglePause}>{state.paused ? "继续" : "暂停"}</Button>
        <Button disabled={visibleLines.length === 0} onClick={copyVisible}>
          复制当前显示
        </Button>
      </div>

      <p className="break-words text-aux text-muted-foreground">
        日志可能包含敏感信息，仅对已知敏感值脱敏；复制需手动操作。
      </p>

      {view.droppedCount > 0 ? (
        <p
          className="break-words rounded-control bg-warning-soft px-ui-lg py-ui-sm text-aux text-warning"
          data-log-truncated
        >
          已丢弃较早的 {view.droppedCount} 行，仅保留最近 {view.lines.length}{" "}
          行
        </p>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-x-ui-xl gap-y-ui-xs text-aux text-muted-foreground">
        <span>
          {filtering
            ? `匹配 ${visibleLines.length} / ${view.lines.length} 行`
            : `${view.lines.length} 行`}
        </span>
        {state.paused ? (
          <span>
            已暂停，视图不再更新
            {pending > 0 ? `；另有 ${pending} 行新日志，继续后显示` : ""}
          </span>
        ) : null}
        <span role="status">
          {copyFeedback === "copied"
            ? `已复制 ${visibleLines.length} 行到剪贴板`
            : copyFeedback === "failed"
              ? "复制失败：无法写入剪贴板"
              : ""}
        </span>
      </div>

      <div
        ref={scrollerRef}
        aria-label={`${label}内容`}
        aria-live="off"
        className="max-h-96 min-h-32 overflow-auto rounded-control bg-surface-muted px-ui-lg py-ui-md font-mono text-aux text-foreground focus-visible:shadow-focus"
        onScroll={handleScroll}
        role="log"
        tabIndex={0}
      >
        {visibleLines.length === 0 ? (
          <p className="font-sans text-muted-foreground">
            {filtering && view.lines.length > 0 ? "没有匹配的行" : emptyText}
          </p>
        ) : (
          <ol className="m-0 list-none p-0">
            {visibleLines.map((line, index) => (
              <li
                key={index}
                className="min-h-[1lh] whitespace-pre-wrap break-all"
              >
                {line}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
