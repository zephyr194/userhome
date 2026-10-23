import { afterEach, describe, expect, it, vi } from "vitest";
import { formatByteSize, formatDateTime, formatNumber } from "./format";
import {
  LANGUAGE_PREFERENCES,
  formatMessage,
  resolveLocale,
  translate,
  type MessageKey,
} from "./index";
import { en } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

describe("message catalogs", () => {
  it("keeps zh-CN and en keys identical", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("keeps every zh-CN value non-empty", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("keeps Chinese characters out of English values", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(CJK_PATTERN.test(value), key).toBe(false);
    }
  });
});

describe("resolveLocale", () => {
  it("uses explicit preferences regardless of the system language", () => {
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLocale("en", "zh-Hans-CN")).toBe("en");
  });

  it("follows a Chinese system language for the system preference", () => {
    expect(resolveLocale("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-TW")).toBe("zh-CN");
  });

  it("falls back to English for other system languages", () => {
    expect(resolveLocale("system", "ja-JP")).toBe("en");
    expect(resolveLocale("system", undefined)).toBe("en");
  });

  it("lists the three approved preferences", () => {
    expect(LANGUAGE_PREFERENCES).toEqual(["system", "zh-CN", "en"]);
  });
});

describe("translate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the message for the locale", () => {
    expect(translate("zh-CN", "common.refresh")).toBe("刷新");
    expect(translate("en", "common.refresh")).toBe("Refresh");
  });

  it("returns the key and warns in development when a message is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = "not.a.real.key" as MessageKey;

    expect(translate("en", missing)).toBe(missing);
    if (import.meta.env.DEV) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(missing));
    }
  });
});

describe("formatMessage", () => {
  it("interpolates named parameters and leaves unknown ones visible", () => {
    expect(formatMessage("en", "Hello {name}, {missing} stays", { name: "Ada" })).toBe(
      "Hello Ada, {missing} stays",
    );
  });

  it("selects English plural forms with Intl.PluralRules", () => {
    const template = "{count, plural, one {# service} other {# services}}";
    expect(formatMessage("en", template, { count: 1 })).toBe("1 service");
    expect(formatMessage("en", template, { count: 0 })).toBe("0 services");
    expect(formatMessage("en", template, { count: 1200 })).toBe("1,200 services");
  });

  it("uses the other form for Chinese plurals", () => {
    const template = "{count, plural, other {# 个服务}}";
    expect(formatMessage("zh-CN", template, { count: 1 })).toBe("1 个服务");
  });
});

describe("formatting", () => {
  it("formats numbers with the locale separators", () => {
    expect(formatNumber(1234567.5, "en")).toBe("1,234,567.5");
    expect(formatNumber(1234567.5, "zh-CN")).toBe("1,234,567.5");
  });

  it("formats byte sizes with one decimal above one kilobyte", () => {
    expect(formatByteSize(512, "en")).toBe("512 B");
    expect(formatByteSize(2048, "en")).toBe("2.0 KB");
    expect(formatByteSize(3 * 1024 * 1024, "zh-CN")).toBe("3.0 MB");
  });

  it("formats date-times in the requested locale", () => {
    const value = new Date(2026, 9, 23, 14, 5, 9).getTime();
    expect(formatDateTime(value, "zh-CN")).toContain("2026");
    expect(formatDateTime(value, "en")).toContain("2026");
    expect(formatDateTime(value, "en")).not.toBe(formatDateTime(value, "zh-CN"));
  });
});
