import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOG_MAX_LINES,
  INITIAL_LOG_VIEW_STATE,
  appendBoundedLines,
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
  splitLogText,
  totalSeenLines,
  type BoundedLines,
} from "./logBuffer";

const EMPTY: BoundedLines = { lines: [], droppedCount: 0 };

describe("bounded log buffer", () => {
  it("keeps everything below the limit and reports no truncation", () => {
    const next = appendBoundedLines(EMPTY, ["a", "b"], 3);
    expect(next).toEqual({ lines: ["a", "b"], droppedCount: 0 });
  });

  it("drops the oldest lines at the limit and counts them", () => {
    const first = appendBoundedLines(EMPTY, ["a", "b", "c"], 3);
    const next = appendBoundedLines(first, ["d", "e"], 3);
    expect(next.lines).toEqual(["c", "d", "e"]);
    expect(next.droppedCount).toBe(2);
    expect(totalSeenLines(next)).toBe(5);
  });

  it("counts lines of one oversized chunk that never fit", () => {
    const next = appendBoundedLines(EMPTY, ["1", "2", "3", "4", "5"], 2);
    expect(next.lines).toEqual(["4", "5"]);
    expect(next.droppedCount).toBe(3);
  });

  it("does not mutate the previous buffer", () => {
    const first = appendBoundedLines(EMPTY, ["a"], 2);
    appendBoundedLines(first, ["b", "c"], 2);
    expect(first).toEqual({ lines: ["a"], droppedCount: 0 });
  });

  it("boundLines keeps the tail and adds to the source dropped count", () => {
    const bounded = boundLines({ lines: ["a", "b", "c"], droppedCount: 4 }, 2);
    expect(bounded).toEqual({ lines: ["b", "c"], droppedCount: 5 });
  });

  it("normalizes invalid limits", () => {
    expect(normalizeMaxLines(0)).toBe(1);
    expect(normalizeMaxLines(-5)).toBe(1);
    expect(normalizeMaxLines(2.9)).toBe(2);
    expect(normalizeMaxLines(Number.NaN)).toBe(DEFAULT_LOG_MAX_LINES);
    expect(normalizeMaxLines(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_LOG_MAX_LINES,
    );
    expect(appendBoundedLines(EMPTY, ["a", "b"], 0).lines).toEqual(["b"]);
  });

  it("splits chunks into lines without a phantom trailing line", () => {
    expect(splitLogText("a\nb\r\nc\n")).toEqual(["a", "b", "c"]);
    expect(splitLogText("")).toEqual([]);
    expect(splitLogText("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("pause, resume and filter", () => {
  const live1 = appendBoundedLines(EMPTY, ["a", "b", "c"], 3);

  it("keeps the current view unchanged while paused", () => {
    const paused = pauseLogView(INITIAL_LOG_VIEW_STATE, live1);
    const live2 = appendBoundedLines(live1, ["d", "e"], 3);
    expect(currentLogView(paused, live2).lines).toEqual(["a", "b", "c"]);
    expect(currentLogView(paused, live2).droppedCount).toBe(0);
  });

  it("does not lose later data while paused and shows it after resume", () => {
    const paused = pauseLogView(INITIAL_LOG_VIEW_STATE, live1);
    const live2 = appendBoundedLines(live1, ["d", "e"], 3);
    expect(live2.lines).toEqual(["c", "d", "e"]);
    expect(pendingLineCount(paused, live2)).toBe(2);
    const resumed = resumeLogView(paused);
    expect(currentLogView(resumed, live2)).toBe(live2);
    expect(pendingLineCount(resumed, live2)).toBe(0);
  });

  it("pending count includes lines already dropped by the bound", () => {
    const paused = pauseLogView(INITIAL_LOG_VIEW_STATE, live1);
    const live2 = appendBoundedLines(live1, ["1", "2", "3", "4", "5"], 3);
    expect(pendingLineCount(paused, live2)).toBe(5);
  });

  it("pausing twice keeps the first snapshot", () => {
    const paused = pauseLogView(INITIAL_LOG_VIEW_STATE, live1);
    const live2 = appendBoundedLines(live1, ["d"], 3);
    expect(pauseLogView(paused, live2)).toBe(paused);
  });

  it("keeps the query across pause and resume", () => {
    const state = setLogQuery(
      pauseLogView(INITIAL_LOG_VIEW_STATE, live1),
      "err",
    );
    expect(resumeLogView(state).query).toBe("err");
    expect(state.paused).toBe(true);
  });

  it("filters case-insensitively as plain text, not as a pattern", () => {
    const lines = ["Error: boom", "ok", "a.b", "axb"];
    expect(filterLogLines(lines, "")).toBe(lines);
    expect(filterLogLines(lines, "ERROR")).toEqual(["Error: boom"]);
    expect(filterLogLines(lines, "a.b")).toEqual(["a.b"]);
    expect(filterLogLines(lines, ".*")).toEqual([]);
  });

  it("formats copy text from exactly the given lines", () => {
    expect(formatLinesForCopy(["a", "b"])).toBe("a\nb");
    expect(formatLinesForCopy([])).toBe("");
  });

  it("detects a view scrolled near the bottom", () => {
    expect(isNearBottom(900, 100, 1000)).toBe(true);
    expect(isNearBottom(880, 100, 1000)).toBe(true);
    expect(isNearBottom(500, 100, 1000)).toBe(false);
  });
});
