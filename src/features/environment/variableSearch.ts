import type { ChainStep, VariableChainRow } from "./variableChainModel";

export const MAX_QUERY_LENGTH = 100;

/** Splits the query into lowercase words; every word must match (AND). */
export function queryTerms(raw: string): string[] {
  return raw
    .slice(0, MAX_QUERY_LENGTH)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
}

function stepFields(step: ChainStep): string[] {
  const text = step.value.kind === "text" ? [step.value.text] : [];
  return [step.source.file, ...text];
}

/**
 * Secrets and values the list does not carry never take part in matching, so a
 * search cannot reveal what they contain. Merged cross-file rows are matched on
 * their name and per-file steps only; their `final` stands for the first file.
 */
export function chainHitsFor(row: VariableChainRow, terms: readonly string[]): number[] {
  if (terms.length === 0) return [];
  return row.chain.flatMap((step, index) => {
    const haystack = stepFields(step).join("\n").toLowerCase();
    return terms.some((term) => haystack.includes(term)) ? [index] : [];
  });
}

export function matchesVariable(row: VariableChainRow, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const fields = [row.name, ...(row.definedIn === undefined ? stepFields(row.final) : []), ...row.chain.flatMap(stepFields)]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => fields.includes(term));
}

export function filterVariables(
  rows: readonly VariableChainRow[],
  query: string,
): VariableChainRow[] {
  const terms = queryTerms(query);
  return rows.filter((row) => matchesVariable(row, terms));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface HighlightPart {
  readonly text: string;
  readonly marked: boolean;
}

/** Splits text at every occurrence of a term, ignoring case. Terms are literal text, never patterns. */
export function highlightParts(text: string, terms: readonly string[]): HighlightPart[] {
  if (terms.length === 0 || text === "") return [{ text, marked: false }];
  const pattern = new RegExp(
    `(${[...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})`,
    "gi",
  );
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, marked: terms.some((term) => part.toLowerCase() === term) }));
}

const queryMemory = new Map<string, string>();

/** The query of a list survives switching tabs while the page is open; it is never written to disk. */
export function recalledQuery(key: string): string {
  return queryMemory.get(key) ?? "";
}

export function rememberQuery(key: string, query: string): void {
  if (query === "") queryMemory.delete(key);
  else queryMemory.set(key, query);
}

export function forgetQueries(): void {
  queryMemory.clear();
}
