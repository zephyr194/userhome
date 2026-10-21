import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeFormattedJson,
  decodeFormattedXml,
  decodeJsonWarning,
  decodeTransformedText,
  formatJsonArgs,
  formatXml,
  formatXmlArgs,
  transformText,
  transformTextArgs,
} from "./textTools";

const UNKNOWN_ENTITY_NOTICE = "未识别的实体已保留。";

function expectInternal(decode: () => unknown) {
  let thrown: unknown;
  try {
    decode();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toEqual({
    code: "INTERNAL",
    message: "An internal error occurred.",
    retryable: false,
  });
}

describe("format_json payload decoding", () => {
  it("decodes a successful result with warnings", () => {
    expect(
      decodeFormattedJson({
        text: '{\n  "a": 1\n}',
        warnings: [{ key: "a", line: 1, column: 8 }],
        omittedWarnings: 0,
      }),
    ).toEqual({
      text: '{\n  "a": 1\n}',
      warnings: [{ key: "a", line: 1, column: 8 }],
      omittedWarnings: 0,
    });
  });

  it("accepts a result without warnings", () => {
    expect(
      decodeFormattedJson({ text: "{}", warnings: [], omittedWarnings: 0 }),
    ).toEqual({ text: "{}", warnings: [], omittedWarnings: 0 });
  });

  it("fails closed on malformed result shapes", () => {
    expectInternal(() => decodeFormattedJson(null));
    expectInternal(() => decodeFormattedJson([]));
    expectInternal(() =>
      decodeFormattedJson({ warnings: [], omittedWarnings: 0 }),
    );
    expectInternal(() =>
      decodeFormattedJson({ text: 1, warnings: [], omittedWarnings: 0 }),
    );
    expectInternal(() =>
      decodeFormattedJson({ text: "{}", warnings: {}, omittedWarnings: 0 }),
    );
    expectInternal(() =>
      decodeFormattedJson({ text: "{}", warnings: [], omittedWarnings: -1 }),
    );
    expectInternal(() =>
      decodeFormattedJson({ text: "{}", warnings: [], omittedWarnings: 1.5 }),
    );
  });

  it("rejects more warnings than the backend can send", () => {
    const warnings = Array.from({ length: 101 }, () => ({
      key: "a",
      line: 1,
      column: 1,
    }));
    expectInternal(() =>
      decodeFormattedJson({ text: "{}", warnings, omittedWarnings: 0 }),
    );
  });

  it("rejects malformed warning positions and keys", () => {
    expectInternal(() => decodeJsonWarning({ key: "a", line: 0, column: 1 }));
    expectInternal(() => decodeJsonWarning({ key: "a", line: 1, column: "2" }));
    expectInternal(() =>
      decodeJsonWarning({ key: "a", line: 1.5, column: 1 }),
    );
    expectInternal(() =>
      decodeJsonWarning({ key: "x".repeat(66), line: 1, column: 1 }),
    );
    expectInternal(() => decodeJsonWarning({ line: 1, column: 1 }));
  });

  it("accepts a warning key truncated to the backend limit", () => {
    const key = `${"k".repeat(64)}…`;
    expect(decodeJsonWarning({ key, line: 2, column: 3 })).toEqual({
      key,
      line: 2,
      column: 3,
    });
  });
});

describe("format_json request arguments", () => {
  it("wraps the text and mode in the typed input object", () => {
    expect(formatJsonArgs('{"a":1}', "INDENT4")).toEqual({
      input: { text: '{"a":1}', mode: "INDENT4" },
    });
  });
});

afterEach(() => {
  clearMocks();
});

describe("transform_text payload decoding", () => {
  it("decodes a result with and without the known notice", () => {
    expect(decodeTransformedText({ text: "f", notices: [] })).toEqual({
      text: "f",
      notices: [],
    });
    expect(
      decodeTransformedText({
        text: "&copy;",
        notices: [UNKNOWN_ENTITY_NOTICE],
      }),
    ).toEqual({ text: "&copy;", notices: [UNKNOWN_ENTITY_NOTICE] });
  });

  it("fails closed on malformed result shapes", () => {
    expectInternal(() => decodeTransformedText(null));
    expectInternal(() => decodeTransformedText({ notices: [] }));
    expectInternal(() => decodeTransformedText({ text: 1, notices: [] }));
    expectInternal(() => decodeTransformedText({ text: "a", notices: "x" }));
    expectInternal(() =>
      decodeTransformedText({ text: "a", notices: ["随便一条"] }),
    );
    expectInternal(() => decodeTransformedText({ text: "a", notices: [1] }));
    expectInternal(() =>
      decodeTransformedText({
        text: "a",
        notices: Array.from({ length: 5 }, () => UNKNOWN_ENTITY_NOTICE),
      }),
    );
  });
});

describe("transform_text request arguments", () => {
  it("sends exactly the text, algorithm and direction", () => {
    expect(transformTextArgs("a+b", "URL_COMPONENT", "DECODE")).toEqual({
      input: { text: "a+b", algorithm: "URL_COMPONENT", direction: "DECODE" },
    });
  });

  it("invokes transform_text and decodes the typed result", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return { text: "5Lit", notices: [] };
    });

    await expect(transformText("中", "BASE64", "ENCODE")).resolves.toEqual({
      text: "5Lit",
      notices: [],
    });
    expect(seen?.command).toBe("transform_text");
    expect(seen?.payload).toEqual({
      input: { text: "中", algorithm: "BASE64", direction: "ENCODE" },
    });
  });

  it("rejects a malformed response instead of showing it", async () => {
    mockIPC(() => ({ text: 1, notices: [] }));
    await expect(
      transformText("a", "BASE64", "ENCODE"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("format_xml payload decoding", () => {
  it("decodes a successful result", () => {
    expect(decodeFormattedXml({ text: "<a>\n  <b/>\n</a>" })).toEqual({
      text: "<a>\n  <b/>\n</a>",
    });
  });

  it("fails closed on malformed result shapes", () => {
    expectInternal(() => decodeFormattedXml(null));
    expectInternal(() => decodeFormattedXml([]));
    expectInternal(() => decodeFormattedXml({}));
    expectInternal(() => decodeFormattedXml({ text: 1 }));
    expectInternal(() => decodeFormattedXml({ text: null }));
  });

  it("drops fields it does not declare instead of forwarding them", () => {
    expect(
      decodeFormattedXml({ text: "<a/>", warnings: [], extra: "x" }),
    ).toEqual({ text: "<a/>" });
  });
});

describe("format_xml request arguments", () => {
  it("wraps the text and mode in the typed input object", () => {
    expect(formatXmlArgs("<a/>", "INDENT4")).toEqual({
      input: { text: "<a/>", mode: "INDENT4" },
    });
  });

  it("invokes format_xml and decodes the typed result", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return { text: "<a>\n  <b/>\n</a>" };
    });

    await expect(formatXml("<a><b/></a>", "INDENT2")).resolves.toEqual({
      text: "<a>\n  <b/>\n</a>",
    });
    expect(seen?.command).toBe("format_xml");
    expect(seen?.payload).toEqual({
      input: { text: "<a><b/></a>", mode: "INDENT2" },
    });
  });

  it("rejects a malformed response instead of showing it", async () => {
    mockIPC(() => ({ text: 1 }));
    await expect(formatXml("<a/>", "INDENT2")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("transform_text URL-safe Base64 requests", () => {
  it("sends the URL-safe algorithm as its own enum value", () => {
    expect(transformTextArgs("😀", "BASE64_URL_SAFE", "ENCODE")).toEqual({
      input: { text: "😀", algorithm: "BASE64_URL_SAFE", direction: "ENCODE" },
    });
  });

  it("invokes transform_text and returns the unpadded result", async () => {
    let seen: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      seen = { command, payload };
      return { text: "8J-YgA", notices: [] };
    });

    await expect(
      transformText("😀", "BASE64_URL_SAFE", "ENCODE"),
    ).resolves.toEqual({ text: "8J-YgA", notices: [] });
    expect(seen?.command).toBe("transform_text");
    expect(seen?.payload).toEqual({
      input: { text: "😀", algorithm: "BASE64_URL_SAFE", direction: "ENCODE" },
    });
  });

  it("rejects malformed URL-safe responses instead of showing them", async () => {
    mockIPC(() => ({ text: null, notices: [] }));
    await expect(
      transformText("8J-YgA", "BASE64_URL_SAFE", "DECODE"),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    mockIPC(() => ({ text: "a", notices: [UNKNOWN_ENTITY_NOTICE, 7] }));
    await expect(
      transformText("8J-YgA", "BASE64_URL_SAFE", "DECODE"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
