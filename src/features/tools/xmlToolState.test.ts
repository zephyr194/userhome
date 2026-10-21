import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { FormattedXml } from "../../ipc/textTools";
import {
  MAX_INPUT_BYTES,
  createRequestTracker,
  exceedsInputLimit,
  failureView,
  oversizedView,
  successView,
} from "./xmlToolState";

const OUTPUT: FormattedXml = { text: "<a>\n  <b/>\n</a>" };

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
  it("makes every in-flight request stale after invalidation", () => {
    const tracker = createRequestTracker();
    const pending = tracker.issue();
    tracker.invalidate();
    expect(tracker.isCurrent(pending)).toBe(false);
  });
});

describe("result views", () => {
  it("shows a success with its text", () => {
    expect(successView(OUTPUT)).toEqual({ status: "success", output: OUTPUT });
  });

  it("keeps line and column for a rejected document", () => {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "结束标签与开始标签不匹配。",
      details: { line: 3, column: 1 },
      retryable: false,
    };
    expect(failureView(error)).toEqual({
      status: "error",
      message: "结束标签与开始标签不匹配。",
      line: 3,
      column: 1,
    });
  });

  it("keeps the reason for a rejected DTD with its position", () => {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "不支持 DTD（DOCTYPE），已拒绝；未读取任何外部资源。",
      details: { line: 1, column: 1 },
      retryable: false,
    };
    expect(failureView(error)).toMatchObject({
      status: "error",
      message: "不支持 DTD（DOCTYPE），已拒绝；未读取任何外部资源。",
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
