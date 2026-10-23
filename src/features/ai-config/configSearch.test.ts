import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  claudeSearchItems,
  configSearchItem,
  countMatches,
  highlightSegments,
  matchesSearch,
  searchTerms,
  type SearchItem,
} from "./configSearch";

const ENV_ITEM = configSearchItem({
  keyPath: "env.ANTHROPIC_BASE_URL",
  description: "API 请求的基础地址，用于代理或兼容网关。",
  allowedValues: [],
});

const PERM_ITEM = configSearchItem({
  keyPath: "permissions.allow",
  description: "Allow rules for tool use. Matches Bash commands.",
  allowedValues: ["Read", "Edit"],
});

describe("searchTerms", () => {
  it("returns no terms for empty or blank input", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   \t ")).toEqual([]);
  });

  it("lowercases and splits on runs of whitespace", () => {
    expect(searchTerms("  Env   Base  ")).toEqual(["env", "base"]);
  });

  it("keeps Chinese text as a single term", () => {
    expect(searchTerms("基础 地址")).toEqual(["基础", "地址"]);
  });

  it("truncates input to the maximum query length", () => {
    const long = "a".repeat(MAX_QUERY_LENGTH + 20);
    expect(searchTerms(long)).toEqual(["a".repeat(MAX_QUERY_LENGTH)]);
  });

  it("counts code points, not UTF-16 units, when truncating", () => {
    const long = "😀".repeat(MAX_QUERY_LENGTH + 5);
    expect(Array.from(searchTerms(long)[0] ?? "")).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("matchesSearch", () => {
  it("matches everything when there are no terms", () => {
    expect(matchesSearch(ENV_ITEM, [])).toBe(true);
  });

  it("matches the key path case-insensitively", () => {
    expect(matchesSearch(ENV_ITEM, searchTerms("ANTHROPIC"))).toBe(true);
  });

  it("matches any fragment of a dotted key path", () => {
    expect(matchesSearch(ENV_ITEM, searchTerms("env"))).toBe(true);
    expect(matchesSearch(ENV_ITEM, searchTerms("base_url"))).toBe(true);
    expect(matchesSearch(PERM_ITEM, searchTerms("perm"))).toBe(true);
  });

  it("matches Chinese description text", () => {
    expect(matchesSearch(ENV_ITEM, searchTerms("代理"))).toBe(true);
  });

  it("matches English description text", () => {
    expect(matchesSearch(PERM_ITEM, searchTerms("bash commands"))).toBe(true);
  });

  it("matches allowed values", () => {
    expect(matchesSearch(PERM_ITEM, searchTerms("edit"))).toBe(true);
  });

  it("matches the title when an item has one", () => {
    const titled: SearchItem = { ...ENV_ITEM, title: "基础地址" };
    expect(matchesSearch(titled, searchTerms("基础地址"))).toBe(true);
  });

  it("requires every term to match, in any field", () => {
    expect(matchesSearch(ENV_ITEM, searchTerms("env 代理"))).toBe(true);
    expect(matchesSearch(ENV_ITEM, searchTerms("env 不存在的词"))).toBe(false);
  });

  it("treats special characters literally, never as a pattern", () => {
    expect(matchesSearch(PERM_ITEM, searchTerms("."))).toBe(true);
    expect(matchesSearch(PERM_ITEM, searchTerms("a.*b"))).toBe(false);
    expect(matchesSearch(PERM_ITEM, searchTerms("("))).toBe(false);
    expect(matchesSearch(PERM_ITEM, searchTerms("[a-z]+"))).toBe(false);
  });

  it("does not throw on a bare backslash or regex metacharacters", () => {
    expect(() => matchesSearch(ENV_ITEM, searchTerms("\\ ^ $ ? *"))).not.toThrow();
  });
});

describe("countMatches", () => {
  it("counts only the items that match every term", () => {
    expect(countMatches([ENV_ITEM, PERM_ITEM], searchTerms("permissions"))).toBe(1);
    expect(countMatches([ENV_ITEM, PERM_ITEM], searchTerms(""))).toBe(2);
  });
});

describe("highlightSegments", () => {
  it("returns the whole text unmarked when there are no terms", () => {
    expect(highlightSegments("permissions.allow", [])).toEqual([
      { text: "permissions.allow", marked: false },
    ]);
  });

  it("marks matches case-insensitively and keeps the original casing", () => {
    expect(highlightSegments("Permissions.Allow", ["allow"])).toEqual([
      { text: "Permissions.", marked: false },
      { text: "Allow", marked: true },
    ]);
  });

  it("marks every occurrence of each term", () => {
    expect(highlightSegments("a-a-a", ["a"])).toEqual([
      { text: "a", marked: true },
      { text: "-", marked: false },
      { text: "a", marked: true },
      { text: "-", marked: false },
      { text: "a", marked: true },
    ]);
  });

  it("merges overlapping matches from different terms", () => {
    expect(highlightSegments("abcdef", ["abc", "bcd"])).toEqual([
      { text: "abcd", marked: true },
      { text: "ef", marked: false },
    ]);
  });

  it("marks Chinese text", () => {
    expect(highlightSegments("API 基础地址", ["基础"])).toEqual([
      { text: "API ", marked: false },
      { text: "基础", marked: true },
      { text: "地址", marked: false },
    ]);
  });

  it("treats regex metacharacters literally", () => {
    expect(highlightSegments("a.*b", [".*"])).toEqual([
      { text: "a", marked: false },
      { text: ".*", marked: true },
      { text: "b", marked: false },
    ]);
  });

  it("leaves the text unmarked when a term has no occurrence", () => {
    expect(highlightSegments("env", ["zzz"])).toEqual([{ text: "env", marked: false }]);
  });
});

describe("claudeSearchItems", () => {
  it("uses catalog descriptions and adds configured keys that have no catalog entry", () => {
    const items = claudeSearchItems(
      ["env.ANTHROPIC_BASE_URL", "unknown.key"],
      [
        {
          keyPath: "env.ANTHROPIC_BASE_URL",
          description: "API 请求的基础地址",
          allowedValues: [],
        },
      ],
    );
    expect(items.map((item) => item.keyPath)).toEqual([
      "env.ANTHROPIC_BASE_URL",
      "unknown.key",
    ]);
    expect(items[0]?.description).toBe("API 请求的基础地址");
    expect(items[1]?.description).toBe("");
  });

  it("lists each key once even if it appears in both sources", () => {
    const items = claudeSearchItems(
      ["permissions.allow"],
      [{ keyPath: "permissions.allow", description: "规则", allowedValues: [] }],
    );
    expect(items).toHaveLength(1);
  });
});
