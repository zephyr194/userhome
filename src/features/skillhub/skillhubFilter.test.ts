import { describe, expect, it } from "vitest";
import { SKILL_CATALOG, type SkillEntry } from "./skillCatalog";
import { countSkillEntries, filterSkillGroups } from "./skillhubFilter";

const ALL = { query: "", source: "all", kind: "all" } as const;

describe("SKILLHUB 过滤", () => {
  it("无过滤时保留全部条目，并按分组首次出现的顺序排列", () => {
    const groups = filterSkillGroups(ALL);
    expect(countSkillEntries(groups)).toBe(SKILL_CATALOG.length);
    const names = groups.map((group) => group.group);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe(SKILL_CATALOG[0].group);
  });

  it("按来源筛选只保留该来源的条目", () => {
    const groups = filterSkillGroups({ ...ALL, source: "pstack" });
    const entries = groups.flatMap((group) => group.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.source === "pstack")).toBe(true);
  });

  it("按调用类型筛选，无标签的条目不会出现在任何具体类型里", () => {
    const groups = filterSkillGroups({ ...ALL, kind: "user" });
    const entries = groups.flatMap((group) => group.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.kind === "user")).toBe(true);
  });

  it("搜索忽略大小写，并匹配名称、用途与分组", () => {
    expect(countSkillEntries(filterSkillGroups({ ...ALL, query: "TDD" }))).toBeGreaterThan(0);
    const byUsage = filterSkillGroups({ ...ALL, query: "总入口" });
    expect(byUsage.flatMap((group) => group.entries).map((entry) => entry.name)).toContain(
      "using-agent-skills",
    );
    expect(countSkillEntries(filterSkillGroups({ ...ALL, query: "  " }))).toBe(SKILL_CATALOG.length);
  });

  it("没有匹配时返回空列表", () => {
    expect(filterSkillGroups({ ...ALL, query: "没有这样的 skill 名称" })).toEqual([]);
  });

  it("同一分组内按原顺序保留，并能组合多个过滤条件", () => {
    const catalog: readonly SkillEntry[] = [
      { source: "agent", group: "甲", name: "a", usage: "x" },
      { source: "matt", group: "乙", name: "b", usage: "x", kind: "user" },
      { source: "agent", group: "甲", name: "c", usage: "y", kind: "user" },
    ];
    const groups = filterSkillGroups({ query: "", source: "agent", kind: "user" }, catalog);
    expect(groups).toEqual([{ group: "甲", entries: [catalog[2]] }]);
  });
});
