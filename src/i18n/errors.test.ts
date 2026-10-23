import { describe, expect, it } from "vitest";
import type { AppErrorCode } from "../ipc/core";
import { localizeError } from "./errors";
import { translate, type MessageKey } from "./index";

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

describe("localizeError", () => {
  it.each(CODES)("keeps the backend message for %s in zh-CN", (code) => {
    expect(localizeError({ code, message: "后端原文。" }, "zh-CN")).toBe("后端原文。");
  });

  it.each(CODES)("maps %s to an English sentence without Chinese characters", (code) => {
    const text = localizeError({ code, message: "原文" }, "en");
    expect(text).not.toBe("原文");
    expect(text).not.toBe("");
    expect(CJK_PATTERN.test(text)).toBe(false);
  });

  it.each(CODES)("has a zh-CN and an en text for %s under one key", (code) => {
    const key = `error.code.${code}` as MessageKey;
    expect(translate("zh-CN", key)).not.toBe(key);
    expect(translate("en", key)).not.toBe(key);
  });

  it("maps a frontend-generated message to English by its exact zh-CN text", () => {
    expect(localizeError({ code: "INVALID_INPUT", message: "未知的应用配置条目。" }, "en")).toBe(
      "Unknown app config entry.",
    );
  });

  it("prefers a frontend-generated message over the code's own text", () => {
    expect(localizeError({ code: "INTERNAL", message: "预览已失效，请重新预览。" }, "en")).toBe(
      "The preview has expired. Preview the change again.",
    );
  });

  it("keeps the original text for a zh-CN frontend-generated message", () => {
    expect(localizeError({ code: "INVALID_INPUT", message: "没有需要保存的修改。" }, "zh-CN")).toBe(
      "没有需要保存的修改。",
    );
  });

  it("shows the backend message when the code is unknown", () => {
    const unknown = { code: "UNMAPPED", message: "Backend detail" };
    expect(localizeError(unknown, "en")).toBe("Backend detail");
  });

  it("keeps a Chinese backend message that has neither a code mapping nor a frontend match", () => {
    expect(localizeError({ code: "", message: "内部错误" }, "en")).toBe("内部错误");
  });
});
