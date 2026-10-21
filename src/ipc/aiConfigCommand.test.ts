import { describe, expect, it } from "vitest";
import { decodeClaudeBuiltCommand, decodeClaudeOptionSummary } from "./aiConfig";

function flagItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "--model",
    kind: "flag",
    valueType: "string",
    allowedValues: [],
    description: "Set the model for the session.",
    generatable: true,
    secret: false,
    singleInvocation: true,
    excludes: [],
    requires: [],
    risks: [],
    versions: null,
    configAlternative: null,
    ...overrides,
  };
}

function envItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ANTHROPIC_API_KEY",
    kind: "env",
    valueType: "string",
    allowedValues: [],
    description: "API key.",
    generatable: true,
    secret: true,
    singleInvocation: null,
    excludes: [],
    requires: [],
    risks: [],
    versions: null,
    configAlternative: null,
    ...overrides,
  };
}

function summary(items: unknown[]) {
  return { items, coverageNote: "已核实的子集。" };
}

describe("decodeClaudeOptionSummary", () => {
  it("decodes flags, env values and display-only items", () => {
    const decoded = decodeClaudeOptionSummary(
      summary([
        flagItem({ id: "--effort", valueType: "enum", allowedValues: ["low", "high"] }),
        flagItem({
          id: "--restricted",
          valueType: "boolean",
          excludes: ["--dangerously-skip-permissions"],
          versions: { min: "2.1.248", max: "unknown" },
        }),
        envItem({ id: "CLAUDE_CODE_CLIENT_KEY", valueType: "unknown", generatable: false, secret: false }),
      ]),
    );
    expect(decoded.items).toHaveLength(3);
    expect(decoded.items[0].allowedValues).toEqual(["low", "high"]);
    expect(decoded.items[1].versions).toEqual({ min: "2.1.248", max: "unknown" });
    expect(decoded.items[2].generatable).toBe(false);
    expect(decoded.coverageNote).toBe("已核实的子集。");
  });

  it("rejects an unknown extra key on an item", () => {
    expect(() => decodeClaudeOptionSummary(summary([flagItem({ extra: true })]))).toThrow();
  });

  it("rejects a generatable flag that disagrees with its unknown type", () => {
    expect(() =>
      decodeClaudeOptionSummary(summary([envItem({ valueType: "unknown", generatable: true })])),
    ).toThrow();
  });

  it("rejects a secret that is not an environment variable", () => {
    expect(() => decodeClaudeOptionSummary(summary([flagItem({ secret: true })]))).toThrow();
  });

  it("rejects enum values without a list and lists on non-enum items", () => {
    expect(() =>
      decodeClaudeOptionSummary(summary([flagItem({ valueType: "enum", allowedValues: [] })])),
    ).toThrow();
    expect(() =>
      decodeClaudeOptionSummary(summary([flagItem({ valueType: "string", allowedValues: ["x"] })])),
    ).toThrow();
  });

  it("rejects an unknown risk, a malformed version range and a wrong singleInvocation", () => {
    expect(() =>
      decodeClaudeOptionSummary(summary([flagItem({ risks: ["deleteEverything"] })])),
    ).toThrow();
    expect(() =>
      decodeClaudeOptionSummary(summary([flagItem({ versions: { min: "2.1.1" } })])),
    ).toThrow();
    expect(() =>
      decodeClaudeOptionSummary(summary([flagItem({ singleInvocation: null })])),
    ).toThrow();
    expect(() =>
      decodeClaudeOptionSummary(summary([envItem({ singleInvocation: true })])),
    ).toThrow();
  });

  it("rejects a non-object response", () => {
    expect(() => decodeClaudeOptionSummary(null)).toThrow();
    expect(() => decodeClaudeOptionSummary("summary")).toThrow();
  });
});

describe("decodeClaudeBuiltCommand", () => {
  const valid = {
    text: "ANTHROPIC_API_KEY='<在此填入，勿提交>' claude --model='sonnet'",
    notices: [{ id: "--model", status: "unconfirmed", message: "本机版本未确认。" }],
    placeholders: ["ANTHROPIC_API_KEY"],
  };

  it("decodes the generated text with its notices and placeholders", () => {
    expect(decodeClaudeBuiltCommand(valid)).toEqual(valid);
  });

  it("rejects control characters in the command text", () => {
    expect(() => decodeClaudeBuiltCommand({ ...valid, text: "claude\u0000" })).toThrow();
    expect(() => decodeClaudeBuiltCommand({ ...valid, text: "claude\n--bare" })).toThrow();
  });

  it("rejects an unknown version status and an extra key", () => {
    expect(() =>
      decodeClaudeBuiltCommand({
        ...valid,
        notices: [{ id: "--model", status: "maybe", message: "x" }],
      }),
    ).toThrow();
    expect(() => decodeClaudeBuiltCommand({ ...valid, command: "claude" })).toThrow();
  });
});
