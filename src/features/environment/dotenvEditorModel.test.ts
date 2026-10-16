import { describe, expect, it } from "vitest";
import type { EnvFileView, EnvRow } from "../../ipc/environment";
import {
  EMPTY_DRAFTS,
  checkDrafts,
  entryEditability,
  keyProblem,
  looksLikeSecretName,
  previewHeadline,
  recoveryText,
  saveResultText,
  valueProblem,
  type Drafts,
  type EditorTarget,
} from "./dotenvEditorModel";

type Entry = Extract<EnvRow, { kind: "ENTRY" }>;

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    kind: "ENTRY",
    line: 1,
    endLine: 1,
    key: "PORT",
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 4,
    value: "3000",
    quote: "NONE",
    flags: [],
    ...overrides,
  };
}

function file(rows: EnvRow[]): EnvFileView {
  return {
    relativePath: ".env",
    kind: "ENVIRONMENT",
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: rows.length,
    secretCount: 0,
    flaggedCount: 0,
  };
}

function existing(rows: EnvRow[]): EditorTarget {
  return {
    kind: "existing",
    grantId: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
    path: ".env",
    settings: { patterns: [".env"], recursive: false },
    file: file(rows),
  };
}

const NEW_TARGET: EditorTarget = {
  kind: "new",
  grantId: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
  displayPath: "~/proj/.env.local",
};

function drafts(patch: Partial<Drafts>): Drafts {
  return { ...EMPTY_DRAFTS, ...patch };
}

describe("secret names", () => {
  it("mirrors the backend heuristic so inputs for secrets are masked", () => {
    for (const key of [
      "API_TOKEN", "github_token", "DB_PASSWORD", "DB_PASSWD", "CLIENT_SECRET",
      "AWS_ACCESS_KEY_ID", "STRIPE_KEY", "APIKEY", "SERVICE_CREDENTIALS",
      "PRIVATE_KEY_PATH", "BASIC_AUTH",
    ]) {
      expect(looksLikeSecretName(key), key).toBe(true);
    }
    for (const key of ["PORT", "NODE_ENV", "LOG_LEVEL", "KEYBOARD_LAYOUT", "PATHNAME"]) {
      expect(looksLikeSecretName(key), key).toBe(false);
    }
  });
});

describe("key and value checks", () => {
  it("accepts dotenv names only", () => {
    for (const key of ["A", "_a", "a_1", "ABC_DEF9"]) expect(keyProblem(key)).toBeUndefined();
    for (const key of ["", "1A", "A-B", "A B", "A=B", "é", "A.B", "x".repeat(256)]) {
      expect(keyProblem(key), key).toEqual(expect.any(String));
    }
  });

  it("refuses values that cannot be written as one literal line", () => {
    for (const value of ["", "plain", "a b", "it's", "p$$w", "$HOME", "`x`", "#x", "é😀", "'", '"', "back\\slash"]) {
      expect(valueProblem(value), value).toBeUndefined();
    }
    for (const value of [
      "a\nb", "a\rb", "a\0b", "tab\there", "bell\u0007", "line sep",
      "rtl‮over", "mark‏x", "bom﻿x",
    ]) {
      expect(valueProblem(value), JSON.stringify(value)).toMatch(/换行|控制/);
    }
    expect(valueProblem("it's $5")).toMatch(/单引号/);
    expect(valueProblem("it's \"q\"")).toMatch(/单引号/);
    expect(valueProblem("x".repeat(8193))).toMatch(/8192/);
    expect(valueProblem("😀".repeat(8192))).toBeUndefined();
  });
});

describe("which entries can be edited", () => {
  it("allows a plain entry and a masked secret", () => {
    expect(entryEditability(entry())).toEqual({ ok: true });
    expect(
      entryEditability(entry({ secret: true, value: undefined, key: "API_TOKEN" })),
    ).toEqual({ ok: true });
  });

  it("explains why an unsupported entry is left alone", () => {
    const cases: [Partial<Entry>, RegExp][] = [
      [{ flags: ["DUPLICATE_KEY"] }, /重复键/],
      [{ flags: ["INTERPOLATION"] }, /变量插值/],
      [{ flags: ["COMMAND_SUBSTITUTION"] }, /命令替换/],
      [{ flags: ["MULTILINE_VALUE"] }, /多行/],
      [{ flags: ["DUPLICATE_KEY", "INTERPOLATION"] }, /重复键.*变量插值/],
      [{ quote: "DOUBLE", value: "a\\nb", valueLength: 4 }, /转义/],
      [{ value: undefined, valueLength: 9000 }, /过长/],
    ];
    for (const [patch, reason] of cases) {
      const result = entryEditability(entry(patch));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
  });

  it("does not block a single-quoted value that contains a backslash", () => {
    expect(
      entryEditability(entry({ quote: "SINGLE", value: "a\\nb", valueLength: 4 })),
    ).toEqual({ ok: true });
  });
});

describe("turning drafts into edits", () => {
  const rows = [
    entry({ key: "PORT", line: 1 }),
    entry({ key: "API_TOKEN", secret: true, value: undefined, line: 2 }),
    entry({ key: "OLD", line: 3, value: "x", valueLength: 1 }),
    entry({ key: "DYN", line: 4, flags: ["INTERPOLATION"], value: "$HOME", valueLength: 5 }),
  ];

  it("has nothing to save until something changed", () => {
    const result = checkDrafts(existing(rows), EMPTY_DRAFTS);
    expect(result.edits).toEqual([]);
    expect(result.ready).toBe(false);
    expect(result.problems).toEqual({ entries: {}, additions: {} });
  });

  it("sends only real changes", () => {
    const result = checkDrafts(
      existing(rows),
      drafts({
        entryEdits: {
          PORT: { mode: "set", value: "8080" },
          OLD: { mode: "remove", value: "" },
          // Unchanged text and an empty secret replacement are not edits.
          API_TOKEN: { mode: "set", value: "" },
        },
        additions: [{ id: 1, key: "REGION", value: "eu", exported: true }],
      }),
    );
    expect(result.edits).toEqual([
      { op: "SET", key: "PORT", value: "8080" },
      { op: "REMOVE", key: "OLD" },
      { op: "ADD", key: "REGION", value: "eu", exported: true },
    ]);
    expect(result.ready).toBe(true);
  });

  it("skips a set that equals the current value and keeps secrets replacement-only", () => {
    const same = checkDrafts(
      existing(rows),
      drafts({ entryEdits: { PORT: { mode: "set", value: "3000" } } }),
    );
    expect(same.edits).toEqual([]);
    const secret = checkDrafts(
      existing(rows),
      drafts({ entryEdits: { API_TOKEN: { mode: "set", value: "new-token" } } }),
    );
    expect(secret.edits).toEqual([{ op: "SET", key: "API_TOKEN", value: "new-token" }]);
  });

  it("reports a problem per draft and blocks the save", () => {
    const result = checkDrafts(
      existing(rows),
      drafts({
        entryEdits: {
          PORT: { mode: "set", value: "a\nb" },
          DYN: { mode: "remove", value: "" },
          GONE: { mode: "set", value: "x" },
        },
        additions: [
          { id: 1, key: "", value: "x", exported: false },
          { id: 2, key: "BAD KEY", value: "x", exported: false },
          { id: 3, key: "PORT", value: "x", exported: false },
          { id: 4, key: "NEW", value: "x", exported: false },
          { id: 5, key: "NEW", value: "y", exported: false },
          { id: 6, key: "OK", value: "it's $5", exported: false },
        ],
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.problems.entries.PORT).toMatch(/换行|控制/);
    expect(result.problems.entries.DYN).toMatch(/变量插值/);
    expect(result.problems.entries.GONE).toEqual(expect.any(String));
    expect(result.problems.additions[1]).toMatch(/键名/);
    expect(result.problems.additions[2]).toMatch(/键名/);
    expect(result.problems.additions[3]).toMatch(/已存在/);
    expect(result.problems.additions[4]).toMatch(/重复/);
    expect(result.problems.additions[5]).toMatch(/重复/);
    expect(result.problems.additions[6]).toMatch(/单引号/);
    expect(result.edits).toEqual([]);
  });

  it("builds a new file from additions only", () => {
    const result = checkDrafts(
      NEW_TARGET,
      drafts({
        additions: [
          { id: 1, key: "PORT", value: "3000", exported: false },
          { id: 2, key: "API_TOKEN", value: "tok", exported: false },
        ],
      }),
    );
    expect(result.ready).toBe(true);
    expect(result.edits).toEqual([
      { op: "ADD", key: "PORT", value: "3000" },
      { op: "ADD", key: "API_TOKEN", value: "tok" },
    ]);
    expect(checkDrafts(NEW_TARGET, EMPTY_DRAFTS).ready).toBe(false);
  });

  it("never turns a draft into an edit for a key the file does not have", () => {
    const result = checkDrafts(
      NEW_TARGET,
      drafts({ entryEdits: { PORT: { mode: "set", value: "1" } } }),
    );
    expect(result.edits).toEqual([]);
    expect(result.ready).toBe(false);
  });
});

describe("wording", () => {
  const preview = (kind: "REPLACE" | "CREATE") =>
    ({
      kind,
      recoveryPoint: kind === "CREATE" ? "NONE_CREATED" : "BACKUP",
    }) as Parameters<typeof previewHeadline>[0];

  it("says whether a file will be created or modified, and what can be restored", () => {
    expect(previewHeadline(preview("CREATE"))).toMatch(/创建/);
    expect(previewHeadline(preview("REPLACE"))).toMatch(/修改/);
    expect(recoveryText("CREATE", "NONE_CREATED")).toMatch(/无恢复点|没有恢复点/);
    expect(recoveryText("REPLACE", "BACKUP")).toMatch(/备份/);
    expect(recoveryText("REPLACE", "NONE_UNAVAILABLE")).toMatch(/不会写入/);
  });

  it("reports each transaction outcome faithfully", () => {
    const base = { kind: "REPLACE", recoveryPoint: "BACKUP" } as const;
    const text = (status: "SUCCEEDED" | "FAILED", fileState: Parameters<typeof saveResultText>[0]["fileState"], kind: "REPLACE" | "CREATE" = "REPLACE") =>
      saveResultText({
        ...base,
        kind,
        recoveryPoint: kind === "CREATE" ? "NONE_CREATED" : "BACKUP",
        status,
        fileState,
      });
    expect(text("SUCCEEDED", "WRITTEN")).toMatchObject({ tone: "success" });
    expect(text("SUCCEEDED", "WRITTEN").headline).toMatch(/已保存.*备份/);
    expect(text("SUCCEEDED", "WRITTEN", "CREATE").headline).toMatch(/已创建.*无恢复点/);
    expect(text("FAILED", "UNCHANGED")).toMatchObject({ tone: "danger" });
    expect(text("FAILED", "UNCHANGED").headline).toMatch(/未改动/);
    expect(text("FAILED", "RESTORED").headline).toMatch(/已恢复/);
    expect(text("FAILED", "RESTORE_FAILED").headline).toMatch(/未能确认|可能/);
    expect(text("FAILED", "CREATED_REMOVED", "CREATE").headline).toMatch(/已移除/);
    expect(text("FAILED", "CREATED_REMOVE_FAILED", "CREATE").headline).toMatch(/可能仍存在/);
    expect(text("FAILED", "UNKNOWN").headline).toMatch(/无法确认/);
  });
});
