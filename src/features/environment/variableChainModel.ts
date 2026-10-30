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
import { zhTranslate } from "./zhTranslate";
import type { TranslateFunction } from "../../i18n";

/** What a variable's value looks like to the reader; secrets never carry text. */
export type ChainValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "empty" }
  /** A secret: masked everywhere; only the final value can be revealed. */
  | { readonly kind: "masked" }
  /** A long non-secret value that the list does not carry; fetched on demand. */
  | { readonly kind: "withheld" };

/** Why a written value cannot be worked out without running the shell. */
export type UnresolvedReason = "reference" | "hidden" | "dynamic" | "append" | "complex";

/**
 * The value that results from the written text. `reference` names the variable
 * that has no earlier static assignment; `hidden` names a secret or long value
 * that is not expanded.
 */
export type Effective =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unresolved"; readonly reason: UnresolvedReason; readonly names: readonly string[] };

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
  readonly effective?: Effective;
}

export interface VariableChainRow {
  readonly name: string;
  /**
   * The value that takes effect. A row merged across files (`definedIn`) has no
   * final value; `final` then only stands for its first file and is never shown as final.
   */
  readonly final: ChainStep;
  /** Every earlier assignment, in reading order; for a merged row, one per file. */
  readonly chain: readonly ChainStep[];
  readonly note?: string;
  /** Set when several files define the same name. Nothing is ranked, so no final is shown. */
  readonly definedIn?: number;
}

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
  readonly position: number;
  readonly row: ZshEntryRow;
  readonly key: string;
}

type EffectiveOf = (item: ZshItem) => Effective | undefined;

function zshValue(row: ZshEntryRow): ChainValue {
  if (!row.hasValue) return { kind: "empty" };
  if (row.secret) return { kind: "masked" };
  if (row.value === undefined) return { kind: "withheld" };
  return { kind: "text", text: row.value };
}

function zshStep(item: ZshItem, effectiveOf: EffectiveOf, scope?: ZshAppliesTo): ChainStep {
  const effective = effectiveOf(item);
  return {
    value: zshValue(item.row),
    source: { file: item.fileName, line: item.row.line },
    ...(scope === undefined ? {} : { scope }),
    ...(item.row.state === "STATIC" ? {} : { state: item.row.state }),
    ...(item.row.operation === "APPEND" ? { append: true } : {}),
    ...(effective === undefined ? {} : { effective }),
  };
}

/** Two finals with the same known effective text merge; masked, dynamic or unknown ones never do. */
function comparableText(item: ZshItem, effectiveOf: EffectiveOf): string | undefined {
  if (item.row.state === "DYNAMIC") return undefined;
  const value = zshValue(item.row);
  if (value.kind === "empty") return "empty";
  if (value.kind !== "text") return undefined;
  const effective = effectiveOf(item);
  return effective?.kind === "text" ? `text:${effective.text}` : undefined;
}

function zshNameRows(
  name: string,
  items: readonly ZshItem[],
  resolution: ZshNameResolution,
  overriddenNote: string,
  effectiveOf: EffectiveOf,
): VariableChainRow[] {
  const visible = items.filter((item) => !resolution.hidden.has(item.key));
  const finals = SCOPE_ORDER.flatMap((scope) => {
    const inScope = visible.filter((item) => item.appliesTo === scope);
    const last = inScope[inScope.length - 1];
    return last ? [last] : [];
  });
  if (finals.length === 0) return [];

  const first = comparableText(finals[0] as ZshItem, effectiveOf);
  const sameText =
    finals.length > 1 &&
    first !== undefined &&
    finals.every((item) => comparableText(item, effectiveOf) === first);

  const outcomes = sameText
    ? [finals.reduce((latest, item) => (items.indexOf(item) > items.indexOf(latest) ? item : latest))]
    : finals;

  return outcomes.map((final) => {
    const note = resolution.notes.get(final.key)?.kind === "unread" ? overriddenNote : undefined;
    const earlier = items.slice(0, items.indexOf(final));
    return {
      name,
      final: zshStep(final, effectiveOf, sameText || finals.length === 1 ? undefined : final.appliesTo),
      chain: earlier.map((item) => zshStep(item, effectiveOf, item.appliesTo)),
      ...(note === undefined ? {} : { note }),
    };
  });
}

const REFERENCE_TOKEN = /\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$|\\/g;
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Resolved =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: UnresolvedReason; readonly names: readonly string[] };

function failed(reason: UnresolvedReason, names: readonly string[] = []): Resolved {
  return { ok: false, reason, names };
}

/**
 * Works out the value each assignment leaves, from the assignments a shell reads
 * before it. A reference reads the latest earlier assignment of its name that the
 * same shell reads; anything that needs the shell itself stays unresolved.
 */
function zshEffectiveResolver(items: readonly ZshItem[], unreadablePositions: readonly number[]): EffectiveOf {
  const memo = new Map<number, Resolved>();

  const latestVisibleBefore = (index: number, name: string): number => {
    const { appliesTo } = items[index] as ZshItem;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const other = items[earlier] as ZshItem;
      if (other.name === name && (other.appliesTo === "ALL" || other.appliesTo === appliesTo)) {
        return earlier;
      }
    }
    return -1;
  };

  const lookup = (index: number, name: string): Resolved => {
    const source = latestVisibleBefore(index, name);
    if (source < 0) return failed("reference", [name]);
    const low = (items[source] as ZshItem).position;
    const high = (items[index] as ZshItem).position;
    if (unreadablePositions.some((position) => position > low && position < high)) {
      return failed("reference", [name]);
    }
    const sub = valueAt(source);
    if (sub.ok) return sub;
    return failed(sub.reason, sub.reason === "reference" ? sub.names : [name]);
  };

  const expand = (index: number, text: string): Resolved => {
    let out = "";
    let last = 0;
    for (const match of text.matchAll(REFERENCE_TOKEN)) {
      const [token, braced, plain] = match;
      const at = match.index ?? 0;
      out += text.slice(last, at);
      last = at + token.length;
      const name = braced ?? plain;
      if (name === undefined || !SHELL_NAME.test(name)) return failed("complex");
      const resolved = lookup(index, name);
      if (!resolved.ok) return resolved;
      out += resolved.text;
    }
    return { ok: true, text: out + text.slice(last) };
  };

  const compute = (index: number): Resolved => {
    const item = items[index] as ZshItem;
    if (item.row.state === "DYNAMIC") return failed("dynamic");
    if (item.row.operation === "APPEND") return failed("append");
    const value = zshValue(item.row);
    if (value.kind === "empty") return { ok: true, text: "" };
    if (value.kind !== "text") return failed("hidden", [item.name]);
    if (item.row.state !== "REFERENCE") return { ok: true, text: value.text };
    return expand(index, value.text);
  };

  const valueAt = (index: number): Resolved => {
    const cached = memo.get(index);
    if (cached) return cached;
    const result = compute(index);
    memo.set(index, result);
    return result;
  };

  return (item) => {
    const value = zshValue(item.row);
    if (value.kind === "masked" || value.kind === "withheld") return undefined;
    const result = valueAt(items.indexOf(item));
    return result.ok
      ? { kind: "text", text: result.text }
      : { kind: "unresolved", reason: result.reason, names: result.names };
  };
}

/**
 * One row per name. A name whose last value differs between scopes (all shells,
 * login, interactive) gets one row per scope; equal values merge into one row.
 * Occurrences that a later plain assignment hides are kept in the chain, so the
 * chain is every earlier assignment in reading order.
 */
export function zshVariableRows(
  overview: ZshOverview,
  t: TranslateFunction = zhTranslate,
): VariableChainRow[] {
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
        position: file.position,
        row,
        key: zshRowKey(file.file as ZshFileKey, row.line),
      });
    }
  }
  const truncated = files.some((file) => file.outcome.status === "READY" && file.outcome.rowsTruncated);
  const unreadablePositions = files
    .filter(
      (file) =>
        file.outcome.status !== "READY" &&
        !(file.outcome.status === "UNAVAILABLE" && file.outcome.reason === "NOT_FOUND"),
    )
    .map((file) => file.position);
  const effectiveOf: EffectiveOf = truncated
    ? () => undefined
    : zshEffectiveResolver(items, unreadablePositions);
  const rows: VariableChainRow[] = [];
  for (const [name, group] of groupByName(items)) {
    rows.push(...zshNameRows(name, group, resolution, t("env.chain.overridden"), effectiveOf));
  }
  return rows.sort(compareVariableNames);
}

export function launchctlVariableRows(
  entries: readonly LaunchctlEntry[],
  sourceLabel: string,
): VariableChainRow[] {
  return entries
    .map((entry): VariableChainRow => ({
      name: entry.key,
      final: {
        value: entry.secret
          ? { kind: "masked" }
          : entry.value === null || entry.value === ""
            ? { kind: "empty" }
            : { kind: "text", text: entry.value },
        source: { file: sourceLabel },
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

/**
 * Inside one file the last occurrence of a key is the one that takes effect. A
 * file cut short by the row limit may repeat a key past the cut, so its names
 * carry a note saying a later line may set them again.
 */
export function dotenvVariableRows(
  view: DotenvFileRows,
  t: TranslateFunction = zhTranslate,
): VariableChainRow[] {
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
      const note = view.truncated ? t("env.chain.truncated") : undefined;
      return { name, final, chain: steps.slice(0, -1), ...(note === undefined ? {} : { note }) };
    })
    .sort(compareVariableNames);
}

export interface DotenvFileRows {
  readonly relativePath: string;
  readonly rows: readonly EnvRow[];
  /** The file had more lines than were read; only the rows above are known. */
  readonly truncated?: boolean;
}

/**
 * Names defined in one file keep their own final value. A name defined in several
 * files is listed once without a final: which file wins depends on the tool that
 * reads them, so every file's value is shown side by side in reading order.
 */
export function dotenvChainRows(
  files: readonly DotenvFileRows[],
  t: TranslateFunction = zhTranslate,
): VariableChainRow[] {
  const perFile = files.flatMap((file) => dotenvVariableRows(file, t));
  return [...groupByName(perFile)]
    .map(([name, group]): VariableChainRow => {
      if (group.length === 1) return group[0] as VariableChainRow;
      const perFileFinals = group.map((row) => row.final);
      return {
        name,
        final: perFileFinals[0] as ChainStep,
        chain: perFileFinals,
        definedIn: group.length,
      };
    })
    .sort(compareVariableNames);
}
