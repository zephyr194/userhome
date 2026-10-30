import { describe, expect, it } from "vitest";
import { SKILL_CATALOG, SKILL_SOURCE_IDS, SKILL_SOURCES } from "./skillCatalog";

describe("SKILLHUB 数据（速查表 v2.4）", () => {
  it("与速查表的 123 条 Skill 一一对应，各来源数量不变", () => {
    expect(SKILL_CATALOG).toHaveLength(123);
    const counts = Object.fromEntries(
      SKILL_SOURCE_IDS.map((id) => [id, SKILL_CATALOG.filter((entry) => entry.source === id).length]),
    );
    expect(counts).toEqual({ agent: 25, matt: 37, pstack: 61 });
  });

  it("同一来源内的 Skill 名称唯一；同名 Skill 只会出现在不同来源", () => {
    const keys = SKILL_CATALOG.map((entry) => `${entry.source}:${entry.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SKILL_CATALOG.filter((entry) => entry.name === "tdd").map((entry) => entry.source).sort()).toEqual([
      "matt",
      "pstack",
    ]);
  });

  it("每个来源都有名称、仓库、入口与定位", () => {
    for (const id of SKILL_SOURCE_IDS) {
      const source = SKILL_SOURCES[id];
      expect(source.name, id).not.toBe("");
      expect(source.repo, id).not.toBe("");
      expect(source.entry, id).not.toBe("");
      expect(source.focus, id).not.toBe("");
    }
  });
});
