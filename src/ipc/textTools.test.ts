import { describe, expect, it } from "vitest";
import {
  decodeFormattedJson,
  decodeJsonWarning,
  formatJsonArgs,
} from "./textTools";

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
