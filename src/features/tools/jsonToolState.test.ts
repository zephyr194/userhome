import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { FormattedJson } from "../../ipc/textTools";
import {
  MAX_INPUT_BYTES,
  createRequestTracker,
  exceedsInputLimit,
  failureView,
  oversizedView,
  successView,
} from "./jsonToolState";

const OUTPUT: FormattedJson = {
  text: '{\n  "a": 1\n}',
  warnings: [{ key: "a", line: 1, column: 8 }],
  omittedWarnings: 2,
};

describe("input limit", () => {
  it("uses the 1 MiB byte limit", () => {
    expect(MAX_INPUT_BYTES).toBe(1024 * 1024);
  });

  it("accepts input of exactly the limit and rejects one byte more", () => {
    expect(exceedsInputLimit("a".repeat(MAX_INPUT_BYTES))).toBe(false);
    expect(exceedsInputLimit("a".repeat(MAX_INPUT_BYTES + 1))).toBe(true);
  });

  it("counts UTF-8 bytes rather than characters", () => {
    const text = "字".repeat(349_526);
    expect(text.length).toBeLessThan(MAX_INPUT_BYTES);
    expect(exceedsInputLimit(text)).toBe(true);
  });
});

describe("request tracker", () => {
  it("treats only the most recently issued request as current", () => {
    const tracker = createRequestTracker();
    const first = tracker.issue();
    const second = tracker.issue();
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it("makes every in-flight request stale after invalidation", () => {
    const tracker = createRequestTracker();
    const pending = tracker.issue();
    tracker.invalidate();
    expect(tracker.isCurrent(pending)).toBe(false);

    const next = tracker.issue();
    expect(tracker.isCurrent(next)).toBe(true);
    expect(tracker.isCurrent(pending)).toBe(false);
  });
});

describe("result views", () => {
  it("shows a success with its text, warnings and mode", () => {
    expect(successView(OUTPUT, "INDENT2")).toEqual({
      status: "success",
      output: OUTPUT,
      mode: "INDENT2",
    });
  });

  it("keeps line and column for a syntax error", () => {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "此处应为逗号或 }",
      details: { line: 3, column: 5 },
      retryable: false,
    };
    expect(failureView(error)).toEqual({
      status: "error",
      message: "此处应为逗号或 }",
      line: 3,
      column: 5,
    });
  });

  it("omits the position when the error carries none", () => {
    const error: AppError = {
      code: "VALIDATION_FAILED",
      message: "格式化结果超过 8 MiB 上限，未输出。",
      retryable: false,
    };
    expect(failureView(error)).toEqual({
      status: "error",
      message: "格式化结果超过 8 MiB 上限，未输出。",
    });
  });

  it("ignores non-numeric position details", () => {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "x",
      details: { line: "3", column: 5 },
      retryable: false,
    };
    expect(failureView(error)).toEqual({ status: "error", message: "x" });
  });

  it("reports oversized input without a request", () => {
    expect(oversizedView()).toEqual({
      status: "error",
      message: "输入超过 1 MiB 上限，未发送。",
    });
  });
});
