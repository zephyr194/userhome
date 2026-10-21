import type { LogCursor, LogReset, LogSnapshot } from "../../ipc/services";

export const LOG_POLL_INTERVAL_MS = 2000;
export const LOG_MIN_POLL_INTERVAL_MS = 1000;
/** Lines kept in the viewer buffer; the oldest are dropped and counted. */
export const LOG_MAX_LINES = 2000;
/** Approximate byte bound for the buffer, measured in UTF-16 units. */
export const LOG_MAX_CHARS = 512 * 1024;

const MAX_NOTICES = 8;

export interface LogTail {
  /** Complete lines, oldest first. */
  readonly lines: readonly string[];
  /** Text after the last line break, not yet a complete line. */
  readonly partial: string;
  readonly droppedCount: number;
  readonly cursor: LogCursor | null;
  readonly notices: readonly string[];
  readonly missing: boolean;
}

export const EMPTY_LOG_TAIL: LogTail = {
  lines: [],
  partial: "",
  droppedCount: 0,
  cursor: null,
  notices: [],
  missing: false,
};

export function clampPollInterval(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) return LOG_POLL_INTERVAL_MS;
  return Math.max(LOG_MIN_POLL_INTERVAL_MS, Math.floor(milliseconds));
}

export function splitLogChunk(text: string): {
  lines: string[];
  partial: string;
} {
  if (text === "") return { lines: [], partial: "" };
  const parts = text.split(/\r?\n/);
  const partial = parts.pop() ?? "";
  return { lines: parts, partial };
}

/** Drops the oldest lines until both the line and the size limits hold. */
export function boundLogLines(
  lines: readonly string[],
  droppedCount: number,
): { lines: readonly string[]; droppedCount: number } {
  let start = 0;
  let chars = 0;
  for (const line of lines) chars += line.length;
  while (
    lines.length - start > 1 &&
    (lines.length - start > LOG_MAX_LINES || chars > LOG_MAX_CHARS)
  ) {
    chars -= lines[start].length;
    start += 1;
  }
  return {
    lines: start === 0 ? lines : lines.slice(start),
    droppedCount: droppedCount + start,
  };
}

export function resetNotice(reset: LogReset): string {
  return reset === "REPLACED"
    ? "日志文件已轮转（路径指向了新文件），已从新文件尾部重新读取。"
    : "日志文件被截断（变小），已从头重新读取其尾部。";
}

function skippedNotice(bytes: number, incremental: boolean): string {
  return incremental
    ? `已跳过 ${bytes} 字节：新增内容超过单次读取上限，仅显示最近部分。`
    : `文件较大：已省略开头 ${bytes} 字节，仅显示尾部。`;
}

const HEAD_TRIMMED_NOTICE = "已省略读取起点处不完整的一行。";
const LOSSY_NOTICE = "部分字节不是有效的 UTF-8，已用替换字符显示。";

function appendNotice(notices: readonly string[], notice: string): string[] {
  if (notices.includes(notice)) return [...notices];
  return [...notices, notice].slice(-MAX_NOTICES);
}

function cursorOf(snapshot: LogSnapshot): LogCursor | null {
  if (snapshot.identity === null) return null;
  return {
    offset: snapshot.nextOffset,
    device: snapshot.identity.device,
    inode: snapshot.identity.inode,
  };
}

function noticesOf(
  snapshot: LogSnapshot,
  incremental: boolean,
  base: readonly string[],
): string[] {
  let notices = [...base];
  if (snapshot.reset !== null) {
    notices = appendNotice(notices, resetNotice(snapshot.reset));
  }
  if (snapshot.skippedBytes > 0) {
    notices = appendNotice(
      notices,
      skippedNotice(snapshot.skippedBytes, incremental),
    );
  }
  if (snapshot.headTrimmed) {
    notices = appendNotice(notices, HEAD_TRIMMED_NOTICE);
  }
  if (snapshot.lossy) {
    notices = appendNotice(notices, LOSSY_NOTICE);
  }
  return notices;
}

/** The view after a tail read: the newest text of the file, from scratch. */
export function tailFromSnapshot(snapshot: LogSnapshot): LogTail {
  if (snapshot.state === "MISSING") {
    return { ...EMPTY_LOG_TAIL, missing: true };
  }
  const { lines, partial } = splitLogChunk(snapshot.text);
  const bounded = boundLogLines(lines, 0);
  return {
    lines: bounded.lines,
    partial,
    droppedCount: bounded.droppedCount,
    cursor: cursorOf(snapshot),
    notices: noticesOf(snapshot, false, []),
    missing: false,
  };
}

/**
 * Applies an incremental read. A reset (rotation or truncation) starts the view
 * again from the new file's tail; a missing file keeps what was shown.
 */
export function advanceTail(tail: LogTail, snapshot: LogSnapshot): LogTail {
  if (snapshot.state === "MISSING") {
    return { ...tail, missing: true };
  }
  if (snapshot.reset !== null) {
    return tailFromSnapshot(snapshot);
  }
  let lines = tail.lines;
  let carry = tail.partial;
  const notices = noticesOf(snapshot, true, tail.notices);
  if (snapshot.skippedBytes > 0) {
    if (carry !== "") lines = [...lines, carry];
    carry = "";
  }
  const added = splitLogChunk(carry + snapshot.text);
  const bounded = boundLogLines([...lines, ...added.lines], tail.droppedCount);
  return {
    lines: bounded.lines,
    partial: added.partial,
    droppedCount: bounded.droppedCount,
    cursor: cursorOf(snapshot) ?? tail.cursor,
    notices,
    missing: false,
  };
}

/** Lines for the viewer, with the unfinished last line shown when it has text. */
export function displayLines(tail: LogTail): string[] {
  return tail.partial === ""
    ? [...tail.lines]
    : [...tail.lines, tail.partial];
}
