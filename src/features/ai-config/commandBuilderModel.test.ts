import { describe, expect, it } from "vitest";
import type { ClaudeOptionItem } from "../../ipc/aiConfig";
import {
  planRequest,
  relationTexts,
  selectionOf,
  updateItem,
  versionText,
  type Selection,
} from "./commandBuilderModel";

function item(overrides: Partial<ClaudeOptionItem> = {}): ClaudeOptionItem {
  return {
    id: "--model",
    kind: "flag",
    valueType: "string",
    allowedValues: [],
    description: "Set the model.",
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

const MODEL = item();
const EFFORT = item({ id: "--effort", valueType: "enum", allowedValues: ["low", "high"] });
const BARE = item({ id: "--bare", valueType: "boolean" });
const DANGER = item({
  id: "--dangerously-skip-permissions",
  valueType: "boolean",
  risks: ["relaxesPermissions"],
});
const API_KEY = item({
  id: "ANTHROPIC_API_KEY",
  kind: "env",
  valueType: "string",
  secret: true,
  singleInvocation: null,
});
const SCOPES = item({ id: "CLAUDE_CODE_OAUTH_SCOPES", kind: "env", singleInvocation: null });
const KEY_PATH = item({
  id: "CLAUDE_CODE_CLIENT_KEY",
  kind: "env",
  valueType: "unknown",
  generatable: false,
  singleInvocation: null,
});
const RESTRICTED = item({
  id: "--restricted",
  valueType: "boolean",
  excludes: ["--dangerously-skip-permissions"],
  versions: { min: "2.1.248", max: "unknown" },
});
const NO_SESSION = item({
  id: "--no-session-persistence",
  valueType: "boolean",
  requires: ["--print"],
});
const PRINT = item({ id: "--print", valueType: "boolean" });
const ITEMS = [MODEL, EFFORT, BARE, DANGER, API_KEY, SCOPES, KEY_PATH, RESTRICTED, NO_SESSION, PRINT];

function select(entries: Record<string, Partial<Selection[string]>>): Selection {
  return Object.fromEntries(
    Object.entries(entries).map(([id, state]) => [
      id,
      { checked: true, value: "", acknowledged: false, ...state },
    ]),
  );
}

describe("planRequest", () => {
  it("is empty when nothing is chosen", () => {
    expect(planRequest(ITEMS, {}, "")).toEqual({ status: "empty" });
  });

  it("builds flags and env values, sending null for switches and secrets", () => {
    const plan = planRequest(
      ITEMS,
      select({
        "--model": { value: "sonnet" },
        "--bare": {},
        ANTHROPIC_API_KEY: {},
        CLAUDE_CODE_OAUTH_SCOPES: { value: "user:inference" },
      }),
      "",
    );
    expect(plan).toEqual({
      status: "ready",
      request: {
        flags: [
          { id: "--model", value: "sonnet" },
          { id: "--bare", value: null },
        ],
        env: [
          { id: "ANTHROPIC_API_KEY", value: null },
          { id: "CLAUDE_CODE_OAUTH_SCOPES", value: "user:inference" },
        ],
        acknowledgedRisks: [],
        detectedVersion: null,
      },
    });
  });

  it("stops when a risky item is not acknowledged and does not send a request", () => {
    const plan = planRequest(ITEMS, select({ "--dangerously-skip-permissions": {} }), "");
    expect(plan).toEqual({
      status: "incomplete",
      message: "请先确认「--dangerously-skip-permissions」的风险。",
    });
  });

  it("sends the acknowledged risk and the trimmed version", () => {
    const plan = planRequest(
      ITEMS,
      select({ "--dangerously-skip-permissions": { acknowledged: true } }),
      "  2.1.300 ",
    );
    expect(plan).toMatchObject({
      status: "ready",
      request: {
        flags: [{ id: "--dangerously-skip-permissions", value: null }],
        acknowledgedRisks: ["--dangerously-skip-permissions"],
        detectedVersion: "2.1.300",
      },
    });
  });

  it("stops when a value is missing and requires one for enum choices", () => {
    expect(planRequest(ITEMS, select({ "--model": {} }), "")).toEqual({
      status: "incomplete",
      message: "请填写「--model」的取值。",
    });
    expect(planRequest(ITEMS, select({ "--effort": {} }), "")).toEqual({
      status: "incomplete",
      message: "请填写「--effort」的取值。",
    });
  });

  it("ignores unchecked items and display-only items", () => {
    const plan = planRequest(ITEMS, select({ "--bare": {}, CLAUDE_CODE_CLIENT_KEY: {} }), "");
    expect(plan).toMatchObject({ status: "ready", request: { flags: [{ id: "--bare" }], env: [] } });
  });
});

describe("selection helpers", () => {
  it("updates one item without touching the others", () => {
    const before = select({ "--bare": {} });
    const after = updateItem(before, "--model", { value: "opus" });
    expect(selectionOf(after, "--model").value).toBe("opus");
    expect(after["--bare"]).toBe(before["--bare"]);
    expect(selectionOf(before, "--model").value).toBe("");
  });
});

describe("version and relation text", () => {
  it("states the minimum version or that none is documented", () => {
    expect(versionText(RESTRICTED)).toBe("需要 Claude Code 2.1.248 或更高版本");
    expect(versionText(MODEL)).toBe("文档未给出版本要求");
  });

  it("lists exclusions and dependencies", () => {
    expect(relationTexts(RESTRICTED)).toEqual(["与 --dangerously-skip-permissions 互斥"]);
    expect(relationTexts(NO_SESSION)).toEqual(["需要同时选择 --print"]);
  });
});
