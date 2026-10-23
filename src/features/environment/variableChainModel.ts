import type {
  EnvRow,
  LaunchctlEntry,
  ZshAppliesTo,
  ZshEntryRow,
  ZshFileKey,
  ZshOverview,
  ZshValueState,
} from "../../ipc/environment";
import { resolveZshNames, zshRowKey, type ZshNameResolution } from "./zshModel";

/** What a variable's value looks like to the reader; secrets never carry text. */
export type ChainValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "empty" }
  /** A secret: masked everywhere; only the final value can be revealed. */
  | { readonly kind: "masked" }
  /** A long non-secret value that the list does not carry; fetched on demand. */
  | { readonly kind: "withheld" };

export interface ChainSource {
  readonly file: string;
  readonly line?: number;
}

export interface ChainStep {
  readonly value: ChainValue;
  readonly source: ChainSource;
  readonly scope?: ZshAppliesTo;
  readonly state?: ZshValueState;
  readonly append?: boolean;
}

export interface VariableChainRow {
  readonly name: string;
  readonly final: ChainStep;
  /** Every earlier assignment, in reading order. */
  readonly chain: readonly ChainStep[];
  readonly note?: string;
}

export const LAUNCHCTL_SOURCE = "登录会话（launchctl）";
export const OVERRIDDEN_NOTE = "可能被后面的文件覆盖";

const SCOPE_ORDER: readonly ZshAppliesTo[] = ["ALL", "LOGIN", "INTERACTIVE"];

export function compareVariableNames(left: { readonly name: string }, right: { readonly name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function groupByName<T extends { readonly name: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.name) ?? [];
    group.push(item);
    groups.set(item.name, group);
  }
  return groups;
}

interface ZshItem {
  readonly name: string;
  readonly fileName: string;
  readonly appliesTo: ZshAppliesTo;
  readonly row: ZshEntryRow;
  readonly key: string;
}

function zshValue(row: ZshEntryRow): ChainValue {
  if (!row.hasValue) return { kind: "empty" };
  if (row.secret) return { kind: "masked" };
  if (row.value === undefined) return { kind: "withheld" };
  return { kind: "text", text: row.value };
}

function zshStep(item: ZshItem, scope?: ZshAppliesTo): ChainStep {
  return {
    value: zshValue(item.row),
    source: { file: item.fileName, line: item.row.line },
    ...(scope === undefined ? {} : { scope }),
    ...(item.row.state === "STATIC" ? {} : { state: item.row.state }),
    ...(item.row.operation === "APPEND" ? { append: true } : {}),
  };
}

/** Two finals with the same known text merge; masked, dynamic or unknown ones never do. */
function comparableText(item: ZshItem): string | undefined {
  if (item.row.state === "DYNAMIC") return undefined;
  const value = zshValue(item.row);
  if (value.kind === "text") return `text:${value.text}`;
  if (value.kind === "empty") return "empty";
  return undefined;
}

function zshNameRows(
  name: string,
  items: readonly ZshItem[],
  resolution: ZshNameResolution,
): VariableChainRow[] {
  const visible = items.filter((item) => !resolution.hidden.has(item.key));
  const finals = SCOPE_ORDER.flatMap((scope) => {
    const inScope = visible.filter((item) => item.appliesTo === scope);
    const last = inScope[inScope.length - 1];
    return last ? [last] : [];
  });
  if (finals.length === 0) return [];

  const first = comparableText(finals[0] as ZshItem);
  const sameText =
    finals.length > 1 &&
    first !== undefined &&
    finals.every((item) => comparableText(item) === first);

  const outcomes = sameText
    ? [finals.reduce((latest, item) => (items.indexOf(item) > items.indexOf(latest) ? item : latest))]
    : finals;

  return outcomes.map((final) => {
    const note = resolution.notes.get(final.key)?.kind === "unread" ? OVERRIDDEN_NOTE : undefined;
    const earlier = items.slice(0, items.indexOf(final));
    return {
      name,
      final: zshStep(final, sameText || finals.length === 1 ? undefined : final.appliesTo),
      chain: earlier.map((item) => zshStep(item, item.appliesTo)),
      ...(note === undefined ? {} : { note }),
    };
  });
}

/**
 * One row per name. A name whose last value differs between scopes (all shells,
 * login, interactive) gets one row per scope; equal values merge into one row.
 * Occurrences that a later plain assignment hides are kept in the chain, so the
 * chain is every earlier assignment in reading order.
 */
export function zshVariableRows(overview: ZshOverview): VariableChainRow[] {
  const resolution = resolveZshNames(overview);
  const files = [...overview.files].sort((left, right) => left.position - right.position);
  const items: ZshItem[] = [];
  for (const file of files) {
    if (file.outcome.status !== "READY") continue;
    for (const row of file.outcome.rows) {
      if (row.kind !== "ENTRY") continue;
      items.push({
        name: row.name,
        fileName: file.name,
        appliesTo: file.appliesTo,
        row,
        key: zshRowKey(file.file as ZshFileKey, row.line),
      });
    }
  }
  const rows: VariableChainRow[] = [];
  for (const [name, group] of groupByName(items)) {
    rows.push(...zshNameRows(name, group, resolution));
  }
  return rows.sort(compareVariableNames);
}

export function launchctlVariableRows(entries: readonly LaunchctlEntry[]): VariableChainRow[] {
  return entries
    .map((entry): VariableChainRow => ({
      name: entry.key,
      final: {
        value: entry.secret
          ? { kind: "masked" }
          : entry.value === null
            ? { kind: "empty" }
            : { kind: "text", text: entry.value },
        source: { file: LAUNCHCTL_SOURCE },
      },
      chain: [],
    }))
    .sort(compareVariableNames);
}

function dotenvValue(row: Extract<EnvRow, { kind: "ENTRY" }>): ChainValue {
  if (!row.hasValue) return { kind: "empty" };
  if (row.secret) return { kind: "masked" };
  if (row.value === undefined) return { kind: "withheld" };
  return { kind: "text", text: row.value };
}

/** Inside one file the last occurrence of a key is the one that takes effect. */
export function dotenvVariableRows(view: {
  readonly relativePath: string;
  readonly rows: readonly EnvRow[];
}): VariableChainRow[] {
  const entries = view.rows.flatMap((row) => (row.kind === "ENTRY" ? [row] : []));
  return [...groupByName(entries.map((row) => ({ name: row.key, row })))]
    .map(([name, group]): VariableChainRow => {
      const steps = group.map(
        ({ row }): ChainStep => ({
          value: dotenvValue(row),
          source: { file: view.relativePath, line: row.line },
        }),
      );
      const final = steps[steps.length - 1] as ChainStep;
      return { name, final, chain: steps.slice(0, -1) };
    })
    .sort(compareVariableNames);
}
