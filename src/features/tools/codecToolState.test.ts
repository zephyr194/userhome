import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { TransformedText } from "../../ipc/textTools";
import {
  algorithmOptions,
  directionOptions,
  algorithmNote,
  conversionLabel,
  failureView,
  oversizedView,
  successView,
} from "./codecToolState";

const OUTPUT: TransformedText = { text: "5Lit", notices: [] };

describe("codec option lists", () => {
  it("offers every algorithm and both directions with stable values", () => {
    expect(algorithmOptions().map((option) => option.value)).toEqual([
      "BASE64",
      "BASE64_URL_SAFE",
      "URL_COMPONENT",
      "HTML_ENTITIES",
      "UNICODE_ESCAPES",
      "UTF8_HEX",
    ]);
    expect(directionOptions().map((option) => option.value)).toEqual([
      "ENCODE",
      "DECODE",
    ]);
  });

  it("labels a conversion with its algorithm and direction", () => {
    expect(conversionLabel("BASE64", "ENCODE")).toBe("Base64（UTF-8） · 编码");
    expect(conversionLabel("UTF8_HEX", "DECODE")).toBe("UTF-8 Hex · 解码");
  });

  it("labels URL-safe Base64 as its own algorithm", () => {
    expect(conversionLabel("BASE64_URL_SAFE", "ENCODE")).toBe(
      "Base64（URL-safe） · 编码",
    );
    expect(
      algorithmOptions().find((option) => option.value === "BASE64_URL_SAFE")
        ?.label,
    ).toBe("Base64（URL-safe）");
  });

  it("explains that URL-safe encoding is unpadded and rejects + and /", () => {
    const note = algorithmNote("BASE64_URL_SAFE");
    expect(note).toContain("不带 = 填充");
    expect(note).toContain("+ 和 /");
    expect(algorithmNote("BASE64")).toBeUndefined();
  });
});

describe("result views", () => {
  it("keeps the output with the conversion that produced it", () => {
    expect(successView(OUTPUT, "BASE64", "ENCODE")).toEqual({
      status: "success",
      output: OUTPUT,
      algorithm: "BASE64",
      direction: "ENCODE",
    });
  });

  it("shows only the message of a failure", () => {
    const error: AppError = {
      code: "INVALID_INPUT",
      message: "第 5 个字符：非法 Base64 字符",
      retryable: false,
    };
    expect(failureView(error)).toEqual({
      status: "error",
      message: "第 5 个字符：非法 Base64 字符",
    });
  });

  it("reports an oversized input without a request", () => {
    expect(oversizedView()).toEqual({
      status: "error",
      message: "输入超过 1 MiB 上限，未发送。",
    });
  });
});
