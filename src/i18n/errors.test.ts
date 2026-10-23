import { describe, expect, it } from "vitest";
import type { AppErrorCode } from "../ipc/core";
import { localizeAppErrorMessage } from "./errors";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

const CODES: readonly AppErrorCode[] = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "NOT_SUPPORTED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "CONFLICT",
  "PROCESS_FAILED",
  "PARTIAL_FAILURE",
  "TIMEOUT",
  "INTERNAL",
];

describe("localizeAppErrorMessage", () => {
  it("keeps the backend message in zh-CN", () => {
    expect(
      localizeAppErrorMessage({ code: "CONFLICT", message: "文件已被修改。" }, "zh-CN"),
    ).toBe("文件已被修改。");
  });

  it.each(CODES)("maps %s to an English sentence without Chinese characters", (code) => {
    const text = localizeAppErrorMessage({ code, message: "原文" }, "en");
    expect(text).not.toBe("原文");
    expect(text).not.toBe("");
    expect(CJK_PATTERN.test(text)).toBe(false);
  });

  it("shows the backend message when the code has no mapping", () => {
    const unknown = { code: "UNMAPPED" as AppErrorCode, message: "Backend detail" };
    expect(localizeAppErrorMessage(unknown, "en")).toBe("Backend detail");
  });
});
