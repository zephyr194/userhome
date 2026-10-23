export const MAX_QUERY_LENGTH = 100;

/** A configuration item as the search sees it; the title is optional because no current source supplies one. */
export interface SearchItem {
  readonly keyPath: string;
  readonly title?: string;
  readonly description: string;
  readonly options: readonly string[];
}

export interface HighlightSegment {
  readonly text: string;
  readonly marked: boolean;
}

export function searchTerms(raw: string): string[] {
  const clipped = Array.from(raw).slice(0, MAX_QUERY_LENGTH).join("");
  return clipped
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

export function configSearchItem(source: {
  readonly keyPath: string;
  readonly description: string;
  readonly allowedValues: readonly string[];
}): SearchItem {
  return {
    keyPath: source.keyPath,
    description: source.description,
    options: source.allowedValues,
  };
}

function searchableFields(item: SearchItem): string[] {
  return [item.keyPath, item.title ?? "", item.description, ...item.options].map((field) =>
    field.toLowerCase(),
  );
}

/** Every term must appear somewhere in the item; terms are plain substrings, never patterns. */
export function matchesSearch(item: SearchItem, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const fields = searchableFields(item);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

export function countMatches(items: readonly SearchItem[], terms: readonly string[]): number {
  return items.filter((item) => matchesSearch(item, terms)).length;
}

export function highlightSegments(
  text: string,
  terms: readonly string[],
): HighlightSegment[] {
  const lower = text.toLowerCase();
  // Some characters change length when lowercased, so offsets from `lower` would not line up with `text`.
  if (terms.length === 0 || lower.length !== text.length) {
    return [{ text, marked: false }];
  }
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

/** Catalog rows carry descriptions; read-only entries that have no catalog row are matched by key alone. */
export function claudeSearchItems(
  entryKeys: readonly string[],
  catalog: readonly {
    readonly keyPath: string;
    readonly description: string;
    readonly allowedValues: readonly string[];
  }[],
): SearchItem[] {
  const items = catalog.map(configSearchItem);
  const known = new Set(catalog.map((item) => item.keyPath));
  for (const key of entryKeys) {
    if (known.has(key)) continue;
    known.add(key);
    items.push({ keyPath: key, description: "", options: [] });
  }
  return items;
}
