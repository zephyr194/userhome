import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  chainHitsFor,
  filterVariables,
  forgetQueries,
  highlightParts,
  matchesVariable,
  queryTerms,
  recalledQuery,
  rememberQuery,
} from "./variableSearch";
import type { ChainValue, VariableChainRow } from "./variableChainModel";
import { SECRET_MASK } from "../../components/ui/secretMask";

afterEach(() => forgetQueries());

// The real secret rides along in the fixture, as a leak would carry it; the list only ever shows the mask.
const SECRET_FINAL = { kind: "masked", text: "hunter2" } as ChainValue;
const SECRET_STEP = { kind: "masked", text: "hunter2" } as ChainValue;

const ROWS: VariableChainRow[] = [
  {
    name: "EDITOR",
    final: { value: { kind: "text", text: "code" }, source: { file: ".zlogin", line: 3 } },
    chain: [{ value: { kind: "text", text: "vim" }, source: { file: ".zprofile", line: 1 } }],
  },
  {
    name: "GITHUB_TOKEN",
    final: { value: SECRET_FINAL, source: { file: ".zshrc", line: 5 } },
    chain: [{ value: SECRET_STEP, source: { file: ".zprofile", line: 4 } }],
  },
  {
    name: "PATH",
    final: { value: { kind: "text", text: "/usr/bin:/bin" }, source: { file: ".zshenv", line: 2 } },
    chain: [{ value: { kind: "text", text: "/opt/tools" }, source: { file: ".zshrc", line: 7 } }],
  },
  {
    name: "SHELL_HINT",
    final: { value: { kind: "text", text: "a.b*c" }, source: { file: ".zshrc", line: 9 } },
    chain: [],
  },
  {
    name: "MERGED",
    final: { value: { kind: "text", text: "one" }, source: { file: "a.env", line: 1 } },
    chain: [
      { value: { kind: "text", text: "one" }, source: { file: "a.env", line: 1 } },
      { value: { kind: "text", text: "two" }, source: { file: "b.env", line: 2 } },
    ],
    definedIn: 2,
  },
];

function names(rows: readonly VariableChainRow[]): string[] {
  return rows.map((row) => row.name);
}

describe("queryTerms", () => {
  it("lowercases and splits on whitespace, dropping empty words", () => {
    expect(queryTerms("  Path   ZSHRC ")).toEqual(["path", "zshrc"]);
  });

  it("returns no words for a blank query", () => {
    expect(queryTerms("   ")).toEqual([]);
  });

  it("keeps only the first 100 characters of a long query", () => {
    const long = "a".repeat(150);
    expect(queryTerms(long)).toEqual(["a".repeat(MAX_QUERY_LENGTH)]);
  });
});

describe("filterVariables", () => {
  it("matches the name case-insensitively", () => {
    expect(names(filterVariables(ROWS, "editor"))).toEqual(["EDITOR"]);
  });

  it("matches the source file name of the final value and of process values", () => {
    expect(names(filterVariables(ROWS, ".zprofile"))).toEqual(["EDITOR", "GITHUB_TOKEN"]);
  });

  it("matches non-secret values in the final value and in process values", () => {
    expect(names(filterVariables(ROWS, "/opt"))).toEqual(["PATH"]);
    expect(names(filterVariables(ROWS, "VIM"))).toEqual(["EDITOR"]);
  });

  it("requires every word to match, possibly in different fields of the same row", () => {
    expect(names(filterVariables(ROWS, "path opt"))).toEqual(["PATH"]);
    expect(names(filterVariables(ROWS, "path zlogin"))).toEqual([]);
  });

  it("never matches secret values, so a search cannot reveal them", () => {
    expect(names(filterVariables(ROWS, "github"))).toEqual(["GITHUB_TOKEN"]);
    expect(names(filterVariables(ROWS, "masked"))).toEqual([]);
    expect(names(filterVariables(ROWS, "hunter2"))).toEqual([]);
    expect(names(filterVariables(ROWS, SECRET_MASK))).toEqual([]);
    expect(matchesVariable(ROWS[1] as VariableChainRow, ["secret"])).toBe(false);
    expect(matchesVariable(ROWS[1] as VariableChainRow, ["hunter2"])).toBe(false);
  });

  it("treats special characters as plain text, never as a pattern", () => {
    expect(names(filterVariables(ROWS, "a.b*"))).toEqual(["SHELL_HINT"]);
    expect(names(filterVariables(ROWS, ".*"))).toEqual([]);
    expect(names(filterVariables(ROWS, "("))).toEqual([]);
  });

  it("returns every row for a blank query", () => {
    expect(filterVariables(ROWS, "  ")).toHaveLength(ROWS.length);
  });

  it("does not let the merged row's first-file final decide a match", () => {
    expect(names(filterVariables(ROWS, "two"))).toEqual(["MERGED"]);
    expect(names(filterVariables(ROWS, "b.env"))).toEqual(["MERGED"]);
    expect(names(filterVariables(ROWS, "one"))).toEqual(["MERGED"]);
    expect(matchesVariable({ ...(ROWS[4] as VariableChainRow), chain: [] }, ["a.env"])).toBe(false);
  });
});

describe("chainHitsFor", () => {
  it("reports the process steps that contain a word, so the chain opens on them", () => {
    const row = ROWS[2] as VariableChainRow;
    expect(chainHitsFor(row, ["opt"])).toEqual([0]);
    expect(chainHitsFor(row, ["zshrc"])).toEqual([0]);
    expect(chainHitsFor(row, ["zshenv"])).toEqual([]);
  });

  it("reports nothing without words", () => {
    expect(chainHitsFor(ROWS[0] as VariableChainRow, [])).toEqual([]);
  });
});

describe("highlightParts", () => {
  it("marks each occurrence, ignoring case", () => {
    expect(highlightParts("PATH and path", ["path"])).toEqual([
      { text: "PATH", marked: true },
      { text: " and ", marked: false },
      { text: "path", marked: true },
    ]);
  });

  it("marks several words and keeps the rest of the text", () => {
    expect(highlightParts("zshrc at /opt", ["opt", "zshrc"])).toEqual([
      { text: "zshrc", marked: true },
      { text: " at /", marked: false },
      { text: "opt", marked: true },
    ]);
  });

  it("treats special characters literally", () => {
    expect(highlightParts("a.b*c abc", ["a.b*"])).toEqual([
      { text: "a.b*", marked: true },
      { text: "c abc", marked: false },
    ]);
  });

  it("returns the text unmarked without words", () => {
    expect(highlightParts("text", [])).toEqual([{ text: "text", marked: false }]);
  });
});

describe("query memory", () => {
  it("keeps the query of a list for the page session under its key", () => {
    rememberQuery("zsh", "path");
    expect(recalledQuery("zsh")).toBe("path");
    expect(recalledQuery("dotenv:a")).toBe("");
  });

  it("forgets the query when it is cleared", () => {
    rememberQuery("zsh", "path");
    rememberQuery("zsh", "");
    expect(recalledQuery("zsh")).toBe("");
  });
});
