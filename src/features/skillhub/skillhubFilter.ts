import {
  SKILL_CATALOG,
  type SkillEntry,
  type SkillKind,
  type SkillSourceId,
} from "./skillCatalog";

export type SkillSourceFilter = SkillSourceId | "all";
export type SkillKindFilter = SkillKind | "all";

export interface SkillFilter {
  query: string;
  source: SkillSourceFilter;
  kind: SkillKindFilter;
}

export interface SkillGroup {
  group: string;
  entries: readonly SkillEntry[];
}

/** Groups matching entries by their catalog group, keeping the catalog order of first appearance. */
export function filterSkillGroups(
  filter: SkillFilter,
  catalog: readonly SkillEntry[] = SKILL_CATALOG,
): readonly SkillGroup[] {
  const query = filter.query.trim().toLowerCase();
  const groups = new Map<string, SkillEntry[]>();

  for (const entry of catalog) {
    if (filter.source !== "all" && entry.source !== filter.source) continue;
    if (filter.kind !== "all" && entry.kind !== filter.kind) continue;
    if (query && ![entry.name, entry.usage, entry.group].some((text) => text.toLowerCase().includes(query))) {
      continue;
    }
    const entries = groups.get(entry.group) ?? [];
    entries.push(entry);
    groups.set(entry.group, entries);
  }

  return [...groups].map(([group, entries]) => ({ group, entries }));
}

export function countSkillEntries(groups: readonly SkillGroup[]): number {
  return groups.reduce((total, group) => total + group.entries.length, 0);
}
