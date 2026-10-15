export const DEFAULT_LOG_MAX_LINES = 1000;

const NEAR_BOTTOM_THRESHOLD_PX = 24;

/** 有界行缓冲：lines 只保留最近若干行，droppedCount 记录已丢弃的更早行数。 */
export interface BoundedLines {
  readonly lines: readonly string[];
  readonly droppedCount: number;
}

export interface LogViewState {
  readonly paused: boolean;
  /** 暂停时冻结的视图；继续后清空。 */
  readonly frozen: BoundedLines | null;
  readonly query: string;
}

export const INITIAL_LOG_VIEW_STATE: LogViewState = {
  paused: false,
  frozen: null,
  query: "",
};

export function normalizeMaxLines(maxLines: number): number {
  if (!Number.isFinite(maxLines)) return DEFAULT_LOG_MAX_LINES;
  return Math.max(1, Math.floor(maxLines));
}

export function splitLogText(chunk: string): string[] {
  if (chunk === "") return [];
  const lines = chunk.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function totalSeenLines(buffer: BoundedLines): number {
  return buffer.droppedCount + buffer.lines.length;
}

export function boundLines(
  buffer: BoundedLines,
  maxLines: number,
): BoundedLines {
  const limit = normalizeMaxLines(maxLines);
  const overflow = buffer.lines.length - limit;
  if (overflow <= 0) return buffer;
  return {
    lines: buffer.lines.slice(overflow),
    droppedCount: buffer.droppedCount + overflow,
  };
}

export function appendBoundedLines(
  buffer: BoundedLines,
  incoming: readonly string[],
  maxLines: number,
): BoundedLines {
  return boundLines(
    {
      lines: [...buffer.lines, ...incoming],
      droppedCount: buffer.droppedCount,
    },
    maxLines,
  );
}

/** 暂停时冻结当前视图；已暂停则保持首次快照。 */
export function pauseLogView(
  state: LogViewState,
  current: BoundedLines,
): LogViewState {
  if (state.paused) return state;
  return { ...state, paused: true, frozen: current };
}

export function resumeLogView(state: LogViewState): LogViewState {
  if (!state.paused) return state;
  return { ...state, paused: false, frozen: null };
}

export function setLogQuery(state: LogViewState, query: string): LogViewState {
  return state.query === query ? state : { ...state, query };
}

export function currentLogView(
  state: LogViewState,
  live: BoundedLines,
): BoundedLines {
  return state.paused && state.frozen ? state.frozen : live;
}

/** 暂停期间新到达的行数（含已被上限丢弃的行）。 */
export function pendingLineCount(
  state: LogViewState,
  live: BoundedLines,
): number {
  if (!state.paused || !state.frozen) return 0;
  return Math.max(0, totalSeenLines(live) - totalSeenLines(state.frozen));
}

/** 不区分大小写的纯文本子串筛选；不把输入当作正则。 */
export function filterLogLines(
  lines: readonly string[],
  query: string,
): readonly string[] {
  if (query === "") return lines;
  const needle = query.toLowerCase();
  return lines.filter((line) => line.toLowerCase().includes(needle));
}

export function formatLinesForCopy(lines: readonly string[]): string {
  return lines.join("\n");
}

export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= NEAR_BOTTOM_THRESHOLD_PX;
}
