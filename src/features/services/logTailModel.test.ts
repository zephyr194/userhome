import { describe, expect, it } from "vitest";
import { translate, type TranslateFunction } from "../../i18n";
import type { LogReset, LogSnapshot } from "../../ipc/services";
import {
  EMPTY_LOG_TAIL,
  LOG_MAX_CHARS,
  LOG_MAX_LINES,
  LOG_MIN_POLL_INTERVAL_MS,
  LOG_POLL_INTERVAL_MS,
  advanceTail as advanceTailText,
  boundLogLines,
  clampPollInterval,
  displayLines,
  resetNotice as resetNoticeText,
  splitLogChunk,
  tailFromSnapshot as tailFromSnapshotText,
  type LogTail,
} from "./logTailModel";

const zh: TranslateFunction = (key, params) => translate("zh-CN", key, params);
const en: TranslateFunction = (key, params) => translate("en", key, params);
const advanceTail = (tail: LogTail, snapshot: LogSnapshot) =>
  advanceTailText(tail, snapshot, zh);
const tailFromSnapshot = (snapshot: LogSnapshot) => tailFromSnapshotText(snapshot, zh);
const resetNotice = (reset: LogReset) => resetNoticeText(reset, zh);

const IDENTITY = { device: 16777230, inode: 4242 };

function content(
  text: string,
  overrides: Partial<LogSnapshot> = {},
): LogSnapshot {
  return {
    state: "CONTENT",
    text,
    skippedBytes: 0,
    headTrimmed: false,
    lossy: false,
    reset: null,
    nextOffset: text.length,
    fileSize: text.length,
    identity: IDENTITY,
    ...overrides,
  };
}

const MISSING: LogSnapshot = {
  state: "MISSING",
  text: "",
  skippedBytes: 0,
  headTrimmed: false,
  lossy: false,
  reset: null,
  nextOffset: 0,
  fileSize: 0,
  identity: null,
};

describe("clampPollInterval", () => {
  it("never polls faster than once a second", () => {
    expect(LOG_MIN_POLL_INTERVAL_MS).toBe(1000);
    expect(clampPollInterval(0)).toBe(1000);
    expect(clampPollInterval(500)).toBe(1000);
    expect(clampPollInterval(1500.7)).toBe(1500);
    expect(clampPollInterval(3000)).toBe(3000);
  });

  it("falls back to the default for values that are not numbers", () => {
    expect(clampPollInterval(Number.NaN)).toBe(LOG_POLL_INTERVAL_MS);
    expect(clampPollInterval(Number.POSITIVE_INFINITY)).toBe(
      LOG_POLL_INTERVAL_MS,
    );
  });
});

describe("splitLogChunk", () => {
  it("separates complete lines from the text after the last line break", () => {
    expect(splitLogChunk("")).toEqual({ lines: [], partial: "" });
    expect(splitLogChunk("a\nb")).toEqual({ lines: ["a"], partial: "b" });
    expect(splitLogChunk("a\n")).toEqual({ lines: ["a"], partial: "" });
    expect(splitLogChunk("\n")).toEqual({ lines: [""], partial: "" });
  });

  it("treats CRLF as one line break", () => {
    expect(splitLogChunk("a\r\nb\r\n")).toEqual({
      lines: ["a", "b"],
      partial: "",
    });
  });
});

describe("boundLogLines", () => {
  it("drops the oldest lines past the line limit and counts them", () => {
    const lines = Array.from({ length: LOG_MAX_LINES + 5 }, (_, index) =>
      String(index),
    );
    const bounded = boundLogLines(lines, 10);
    expect(bounded.lines).toHaveLength(LOG_MAX_LINES);
    expect(bounded.lines[0]).toBe("5");
    expect(bounded.droppedCount).toBe(15);
  });

  it("drops the oldest lines past the character limit but keeps the newest", () => {
    const big = "x".repeat(LOG_MAX_CHARS / 2 + 1);
    const bounded = boundLogLines([big, big, "tail"], 0);
    expect(bounded.lines).toEqual([big, "tail"]);
    expect(bounded.droppedCount).toBe(1);
  });

  it("never drops the only line, even when it alone exceeds the limit", () => {
    const huge = "y".repeat(LOG_MAX_CHARS + 10);
    const bounded = boundLogLines([huge], 0);
    expect(bounded.lines).toEqual([huge]);
    expect(bounded.droppedCount).toBe(0);
  });
});

describe("tailFromSnapshot", () => {
  it("keeps the last line unfinished as partial text and records the cursor", () => {
    const tail = tailFromSnapshot(content("a\nb", { nextOffset: 3 }));
    expect(tail.lines).toEqual(["a"]);
    expect(tail.partial).toBe("b");
    expect(tail.cursor).toEqual({ offset: 3, ...IDENTITY });
    expect(tail.missing).toBe(false);
    expect(tail.notices).toEqual([]);
  });

  it("explains a skipped head and a dropped partial first line", () => {
    const tail = tailFromSnapshot(
      content("ccc\n", { skippedBytes: 6, headTrimmed: true }),
    );
    expect(tail.notices.length).toBe(2);
    expect(tail.notices.some((notice) => notice.includes("6"))).toBe(true);
  });

  it("reports a missing file as missing, with no cursor and no text", () => {
    const tail = tailFromSnapshot(MISSING);
    expect(tail).toEqual({ ...EMPTY_LOG_TAIL, missing: true });
  });

  it("names a rotation or truncation in the notices", () => {
    const replaced = tailFromSnapshot(
      content("fresh\n", { reset: "REPLACED" }),
    );
    expect(replaced.notices).toEqual([resetNotice("REPLACED")]);
    const truncated = tailFromSnapshot(
      content("x\n", { reset: "TRUNCATED" }),
    );
    expect(truncated.notices).toEqual([resetNotice("TRUNCATED")]);
    expect(resetNotice("REPLACED")).not.toBe(resetNotice("TRUNCATED"));
  });
});

describe("advanceTail", () => {
  it("appends new text and completes a partial line across reads", () => {
    const first = tailFromSnapshot(content("a\n"));
    const second = advanceTail(first, content("b\nc", { nextOffset: 5 }));
    expect(second.lines).toEqual(["a", "b"]);
    expect(second.partial).toBe("c");
    const third = advanceTail(second, content("d\n", { nextOffset: 7 }));
    expect(third.lines).toEqual(["a", "b", "cd"]);
    expect(third.partial).toBe("");
    expect(third.cursor?.offset).toBe(7);
  });

  it("does not glue text across a skipped gap; the partial line is kept as its own line", () => {
    const tail = advanceTail(
      tailFromSnapshot(content("x")),
      content("y\n", { skippedBytes: 5, nextOffset: 10 }),
    );
    expect(tail.lines).toEqual(["x", "y"]);
    expect(tail.partial).toBe("");
    expect(tail.notices.some((notice) => notice.includes("5"))).toBe(true);
  });

  it("starts over from the new file when the identity changed", () => {
    const before = tailFromSnapshot(content("old\nold2\n"));
    const after = advanceTail(
      before,
      content("fresh\n", { reset: "REPLACED", nextOffset: 6 }),
    );
    expect(after.lines).toEqual(["fresh"]);
    expect(after.droppedCount).toBe(0);
    expect(after.notices).toEqual([resetNotice("REPLACED")]);
  });

  it("marks a missing file without discarding what was already shown", () => {
    const shown = tailFromSnapshot(content("a\nb\n"));
    const gone = advanceTail(shown, MISSING);
    expect(gone.missing).toBe(true);
    expect(gone.lines).toEqual(["a", "b"]);
    expect(gone.cursor).toEqual(shown.cursor);
    const back = advanceTail(gone, content("c\n", { nextOffset: 6 }));
    expect(back.missing).toBe(false);
    expect(back.lines).toEqual(["a", "b", "c"]);
  });

  it("accumulates dropped lines and shows each lossy notice once", () => {
    let tail = tailFromSnapshot(content("q\n"));
    for (let index = 0; index < 3; index += 1) {
      tail = advanceTail(
        tail,
        content("ok\n", { lossy: true, nextOffset: 10 + index }),
      );
    }
    expect(tail.notices.filter((notice) => notice.includes("UTF-8"))).toHaveLength(1);
  });

  it("keeps the buffer bounded across many appends", () => {
    let tail = tailFromSnapshot(content(""));
    const chunk = `${"z".repeat(1000)}\n`;
    for (let index = 0; index < LOG_MAX_CHARS / 1000 + 50; index += 1) {
      tail = advanceTail(tail, content(chunk, { nextOffset: index }));
    }
    const kept = tail.lines.reduce((total, line) => total + line.length, 0);
    expect(kept).toBeLessThanOrEqual(LOG_MAX_CHARS);
    expect(tail.droppedCount).toBeGreaterThan(0);
  });
});

describe("displayLines", () => {
  it("shows the unfinished line last only while it has text", () => {
    expect(displayLines({ ...EMPTY_LOG_TAIL, lines: ["a"], partial: "" })).toEqual(
      ["a"],
    );
    expect(displayLines({ ...EMPTY_LOG_TAIL, lines: ["a"], partial: "b" })).toEqual(
      ["a", "b"],
    );
  });
});

describe("english notices", () => {
  it("words each notice in English without Chinese", () => {
    const notices = [
      resetNoticeText("REPLACED", en),
      resetNoticeText("TRUNCATED", en),
      ...tailFromSnapshotText(content("x\n", { skippedBytes: 12, headTrimmed: true, lossy: true }), en).notices,
    ];
    for (const notice of notices) expect(notice, notice).not.toMatch(/[㐀-鿿豈-﫿]/);
    expect(resetNoticeText("REPLACED", en)).toContain("rotated");
  });
});
