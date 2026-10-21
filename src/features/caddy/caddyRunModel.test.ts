import { describe, expect, it } from "vitest";
import { createRequestTracker } from "./caddyPreviewFlow";
import type { CaddyLogPage, CaddyRunState } from "../../ipc/caddy";
import {
  LOG_LINE_LIMIT,
  applyLogPage,
  canPrepare,
  canStart,
  canStop,
  initialLogView,
  presentRunState,
  takeCompleteLines,
} from "./caddyRunModel";

const ALL_STATES: CaddyRunState[] = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "FAILED",
  "UNKNOWN",
];

function page(overrides: Partial<CaddyLogPage> = {}): CaddyLogPage {
  return {
    sessionId: "s-1",
    stdout: "",
    stderr: "",
    stdoutOffset: 0,
    stderrOffset: 0,
    hasMore: false,
    ...overrides,
  };
}

describe("run state presentation", () => {
  it("gives every state a text label and a symbol, not only a colour", () => {
    for (const state of ALL_STATES) {
      const view = presentRunState(state);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.symbol.length).toBeGreaterThan(0);
    }
  });

  it("shows only the running state as running", () => {
    const labels = ALL_STATES.map((state) => presentRunState(state).label);
    expect(labels.filter((label) => label === "运行中")).toHaveLength(1);
    expect(presentRunState("RUNNING").label).toBe("运行中");
    expect(presentRunState("STARTING").label).not.toBe("运行中");
    expect(presentRunState("UNKNOWN").label).not.toBe("运行中");
  });

  it("uses a distinct symbol for failure and for unknown", () => {
    expect(presentRunState("FAILED").symbol).not.toBe(presentRunState("UNKNOWN").symbol);
    expect(presentRunState("FAILED").symbol).not.toBe(presentRunState("RUNNING").symbol);
  });
});

describe("run action gating", () => {
  it("allows preview and start only from stopped or failed", () => {
    for (const state of ALL_STATES) {
      const idle = state === "STOPPED" || state === "FAILED";
      expect(canPrepare(state)).toBe(idle);
      expect(canStart(state, true)).toBe(idle);
    }
  });

  it("never allows start without a previewed plan", () => {
    expect(canStart("STOPPED", false)).toBe(false);
    expect(canStart("FAILED", false)).toBe(false);
  });

  it("allows stop only while starting or running", () => {
    for (const state of ALL_STATES) {
      expect(canStop(state)).toBe(state === "STARTING" || state === "RUNNING");
    }
  });
});

describe("log line splitting", () => {
  it("returns only complete lines and keeps a trailing partial line pending", () => {
    expect(takeCompleteLines("", "one\ntwo")).toEqual({ lines: ["one"], pending: "two" });
  });

  it("joins a pending partial line with the next chunk", () => {
    expect(takeCompleteLines("two", " and more\nthree\n")).toEqual({
      lines: ["two and more", "three"],
      pending: "",
    });
  });

  it("drops a carriage return before the line break", () => {
    expect(takeCompleteLines("", "a\r\nb\r\n")).toEqual({ lines: ["a", "b"], pending: "" });
  });
});

describe("log view accumulation", () => {
  it("tags stdout and stderr lines and advances both cursors", () => {
    const view = applyLogPage(
      initialLogView("s-1"),
      page({ stdout: "hello\n", stderr: "warn\n", stdoutOffset: 6, stderrOffset: 5 }),
    );
    expect(view.lines).toEqual(["[out] hello", "[err] warn"]);
    expect(view.stdoutOffset).toBe(6);
    expect(view.stderrOffset).toBe(5);
  });

  it("returns the same view when a poll brings nothing new", () => {
    const first = applyLogPage(initialLogView("s-1"), page({ stdout: "a\n", stdoutOffset: 2 }));
    expect(applyLogPage(first, page({ stdoutOffset: 2 }))).toBe(first);
  });

  it("drops the oldest lines past the bound and counts them", () => {
    const flood = Array.from({ length: LOG_LINE_LIMIT + 5 }, (_, index) => `line ${index}`).join(
      "\n",
    );
    const view = applyLogPage(
      initialLogView("s-1"),
      page({ stdout: `${flood}\n`, stdoutOffset: flood.length + 1 }),
    );
    expect(view.lines).toHaveLength(LOG_LINE_LIMIT);
    expect(view.lines[0]).toBe(`[out] line 5`);
    expect(view.dropped).toBe(5);
  });

  it("keeps a backend truncation notice as a visible line", () => {
    const view = applyLogPage(
      initialLogView("s-1"),
      page({ stderr: "[userhome: 已截断更早的 4096 字节]\ntail\n", stderrOffset: 40 }),
    );
    expect(view.lines[0]).toBe("[err] [userhome: 已截断更早的 4096 字节]");
  });
});

describe("stale responses", () => {
  it("lets only the newest request update the view", () => {
    const tracker = createRequestTracker();
    const older = tracker.issue();
    const newer = tracker.issue();
    expect(tracker.isCurrent(older)).toBe(false);
    expect(tracker.isCurrent(newer)).toBe(true);
  });

  it("is invalidated by a start or stop so an in-flight status cannot overwrite it", () => {
    const tracker = createRequestTracker();
    const poll = tracker.issue();
    tracker.invalidate();
    expect(tracker.isCurrent(poll)).toBe(false);
  });
});
