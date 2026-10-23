import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge, TextField } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { CopyButton } from "../../components/ui/CopyButton";
import { SECRET_MASK } from "../../components/ui/secretMask";
import { useT } from "../../i18n/useLocale";
import {
  compareVariableNames,
  type ChainSource,
  type ChainStep,
  type ChainValue,
  type VariableChainRow,
} from "./variableChainModel";
import {
  MAX_QUERY_LENGTH,
  chainHitsFor,
  filterVariables,
  highlightParts,
  queryTerms,
  recalledQuery,
  rememberQuery,
} from "./variableSearch";
import { LazySecretValue } from "./LazySecretValue";
import { appliesToText, valueStateText } from "./zshModel";

export interface VariableChainTableProps {
  /** Accessible name of the table. */
  label: string;
  rows: readonly VariableChainRow[];
  /** Search words to highlight and to open process values for. */
  terms?: readonly string[];
  /** Fetches the final value of a secret or long value; process values never reveal. */
  onRevealFinal: (row: VariableChainRow) => Promise<string>;
  /** Opens the assignment the final value comes from. Absent means read only. */
  onEdit?: (row: VariableChainRow) => void;
  /** Removes the assignment the final value comes from. Absent hides the action. */
  onRemove?: (row: VariableChainRow) => void;
}

export interface VariableChainListProps
  extends Omit<VariableChainTableProps, "rows" | "terms"> {
  rows: readonly VariableChainRow[];
  /** Keys the search words in page memory, so they survive switching tabs. */
  searchKey: string;
  /** Controls shown next to the search field, such as the file filter. */
  filter?: ReactNode;
  /** Shown instead of the list when there are no variables at all. */
  emptyState?: ReactNode;
}

const CELL = "min-w-0 px-ui-8 py-ui-4 align-top";
const NO_KEYS: ReadonlySet<string> = new Set();
const MONO = "break-all font-mono text-aux";

function sourceText(source: ChainSource): string {
  return source.line === undefined ? source.file : `${source.file}:${source.line}`;
}

function rowKey(row: VariableChainRow): string {
  return `${sourceText(row.final.source)}#${row.name}`;
}

function Highlighted({ terms, text }: { terms: readonly string[]; text: string }) {
  return (
    <>
      {highlightParts(text, terms).map((part, index) => (
        <Fragment key={index}>
          {part.marked ? <mark className="config-search-mark">{part.text}</mark> : part.text}
        </Fragment>
      ))}
    </>
  );
}

/** Search field, count and table of one list. Matching is case-insensitive and never reaches secret values. */
export function VariableChainList({
  emptyState,
  filter,
  rows,
  searchKey,
  ...tableProps
}: VariableChainListProps) {
  const t = useT();
  const [query, setQuery] = useState(() => recalledQuery(searchKey));
  useEffect(() => {
    rememberQuery(searchKey, query);
  }, [searchKey, query]);

  const terms = queryTerms(query);
  const matched = filterVariables(rows, query);
  const hasQuery = terms.length > 0;
  const countText = hasQuery
    ? t("env.search.count", { matched: matched.length, total: rows.length })
    : t("env.search.total", { total: rows.length });

  if (rows.length === 0) return <>{emptyState ?? null}</>;

  return (
    <div className="grid min-w-0 gap-ui-8">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <TextField
          className="env-search min-w-0 w-64 max-w-full"
          label={t("env.search.label")}
          inputClassName="h-control-md"
          maxLength={MAX_QUERY_LENGTH}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              setQuery("");
            }
          }}
          onValueChange={setQuery}
          placeholder={t("env.search.placeholder")}
          spellCheck={false}
          type="search"
          value={query}
        />
        {hasQuery ? (
          <Button onClick={() => setQuery("")} size="md" variant="ghost">
            {t("env.search.clear")}
          </Button>
        ) : null}
        <p aria-live="polite" className="text-aux text-muted-foreground">
          {countText}
        </p>
        {filter ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-ui-8">{filter}</div> : null}
      </div>
      {matched.length === 0 ? (
        <AsyncState kind="empty">{t("env.search.empty")}</AsyncState>
      ) : (
        <VariableChainTable {...tableProps} rows={matched} terms={terms} />
      )}
    </div>
  );
}

export function VariableChainTable({
  label,
  onEdit,
  onRemove,
  onRevealFinal,
  rows,
  terms = [],
}: VariableChainTableProps) {
  const t = useT();
  const termsKey = terms.join("\n");
  // Rows the user toggled away from their default; a chain with a search hit opens by default.
  const [flipped, setFlipped] = useState<{ terms: string; keys: ReadonlySet<string> }>(() => ({
    terms: termsKey,
    keys: new Set(),
  }));
  const flippedKeys = flipped.terms === termsKey ? flipped.keys : NO_KEYS;

  const toggle = (key: string) =>
    setFlipped((current) => {
      const base = current.terms === termsKey ? current.keys : NO_KEYS;
      const keys = new Set(base);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      return { terms: termsKey, keys };
    });

  return (
    <div className="min-w-0 max-h-96 overflow-auto">
      <table
        aria-label={label}
        className="env-chain-table w-full min-w-[32rem] table-fixed border-collapse text-aux"
      >
        <colgroup>
          <col className="w-44" />
          <col />
          <col className="w-44" />
          <col className="w-28" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-t border-line bg-surface">
          <tr className="text-left text-meta text-muted-foreground">
            <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.chain.column.name")}</th>
            <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.chain.column.final")}</th>
            <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.chain.column.source")}</th>
            <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.chain.column.chain")}</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort(compareVariableNames).map((row) => {
            const key = rowKey(row);
            const hits = chainHitsFor(row, terms);
            return (
              <Row
                isOpen={(hits.length > 0) !== flippedKeys.has(key)}
                hits={hits}
                key={key}
                onEdit={onEdit}
                onRemove={onRemove}
                onRevealFinal={onRevealFinal}
                onToggle={() => toggle(key)}
                row={row}
                rowId={key}
                terms={terms}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  hits,
  isOpen,
  onEdit,
  onRemove,
  onRevealFinal,
  onToggle,
  row,
  rowId,
  terms,
}: {
  hits: readonly number[];
  isOpen: boolean;
  onEdit?: VariableChainTableProps["onEdit"];
  onRemove?: VariableChainTableProps["onRemove"];
  onRevealFinal: VariableChainTableProps["onRevealFinal"];
  onToggle: () => void;
  row: VariableChainRow;
  rowId: string;
  terms: readonly string[];
}) {
  const t = useT();
  const { final } = row;
  const merged = row.definedIn !== undefined;
  const count = row.chain.length;
  const detailId = `env-chain-${rowId.replace(/[^\w-]/g, "-")}`;
  const editable = !merged;
  return (
    <>
      <tr className="border-t border-line">
        <td className={CELL}>
          <span className="flex min-w-0 flex-wrap items-center gap-ui-4">
            <code className="break-all font-mono text-aux font-semibold">
              <Highlighted terms={terms} text={row.name} />
            </code>
            {!merged && final.scope ? (
              <StatusBadge title={appliesToText(final.scope).detail}>
                {appliesToText(final.scope).label}
              </StatusBadge>
            ) : null}
            {!merged && final.value.kind === "masked" ? (
              <StatusBadge tone="danger">{t("env.chain.badge.secret")}</StatusBadge>
            ) : null}
            {!merged && final.append ? <StatusBadge>{t("env.chain.badge.append")}</StatusBadge> : null}
            {onEdit && editable ? (
              <Button
                aria-label={t("env.chain.edit", { name: row.name })}
                onClick={() => onEdit(row)}
                size="sm"
                variant="ghost"
              >
                {t("env.chain.editButton")}
              </Button>
            ) : null}
            {onRemove ? (
              <Button
                aria-label={t("env.chain.remove", { name: row.name })}
                onClick={() => onRemove(row)}
                size="sm"
                variant="ghost"
              >
                {t("env.chain.removeButton")}
              </Button>
            ) : null}
          </span>
        </td>
        <td className={CELL}>
          {merged ? (
            <StatusBadge>{t("env.chain.definedIn", { count: row.definedIn ?? 0 })}</StatusBadge>
          ) : (
            <>
              <ValueView
                label={row.name}
                load={() => onRevealFinal(row)}
                resetKey={rowId}
                state={final.state}
                terms={terms}
                value={final.value}
              />
              {row.note ? (
                <span className="mt-ui-4 flex">
                  <StatusBadge tone="warning">{row.note}</StatusBadge>
                </span>
              ) : null}
            </>
          )}
        </td>
        <td className={classNames(CELL, MONO, "text-muted-foreground")}>
          {merged ? (
            t("env.chain.severalFiles")
          ) : (
            <Highlighted terms={terms} text={sourceText(final.source)} />
          )}
        </td>
        <td className={CELL}>
          {count > 0 ? (
            <Button
              aria-controls={detailId}
              aria-expanded={isOpen}
              onClick={onToggle}
              size="sm"
              variant="ghost"
            >
              {merged
                ? t("env.chain.expandDefined", { count })
                : t("env.chain.expand", { count })}
            </Button>
          ) : null}
        </td>
      </tr>
      {isOpen && count > 0 ? (
        <tr>
          <td className="px-ui-8 pb-ui-8" colSpan={4} id={detailId}>
            <ol
              aria-label={
                merged
                  ? t("env.chain.definedSteps", { name: row.name })
                  : t("env.chain.steps", { name: row.name })
              }
              className="grid gap-ui-4"
            >
              {row.chain.map((step, index) => (
                <StepView
                  hit={hits.includes(index)}
                  key={index}
                  name={row.name}
                  step={step}
                  terms={terms}
                />
              ))}
              {merged ? null : (
                <StepView final hit={false} name={row.name} step={final} terms={terms} />
              )}
            </ol>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StepView({
  final = false,
  hit,
  name,
  step,
  terms,
}: {
  final?: boolean;
  hit: boolean;
  name: string;
  step: ChainStep;
  terms: readonly string[];
}) {
  const t = useT();
  return (
    <li
      className={classNames(
        "flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-8 py-ui-4",
        final && "border-l-2 border-primary",
        hit && "bg-surface-muted",
      )}
      data-hit={hit ? "true" : undefined}
    >
      {final ? <StatusBadge>{t("env.chain.badge.final")}</StatusBadge> : null}
      <span className="min-w-0 max-w-full">
        <ValueView
          final={final}
          label={name}
          state={step.state}
          terms={terms}
          value={step.value}
        />
      </span>
      <span className={classNames(MONO, "text-muted-foreground")}>
        <Highlighted terms={terms} text={sourceText(step.source)} />
      </span>
      {step.scope ? (
        <StatusBadge title={appliesToText(step.scope).detail}>
          {appliesToText(step.scope).label}
        </StatusBadge>
      ) : null}
    </li>
  );
}

/** Plain text is shown and copyable; secrets and long values stay withheld unless the caller loads them. */
function ValueView({
  final = false,
  label,
  load,
  resetKey,
  state,
  terms,
  value,
}: {
  final?: boolean;
  label: string;
  load?: () => Promise<string>;
  resetKey?: string;
  state?: ChainStep["state"];
  terms: readonly string[];
  value: ChainValue;
}) {
  const t = useT();
  const stateInfo = state && state !== "STATIC" ? valueStateText(state) : undefined;
  if (value.kind === "empty") {
    return <span className="text-aux text-muted-foreground">{t("env.chain.empty")}</span>;
  }
  if (value.kind === "text") {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <code className={classNames(MONO)}>
          <Highlighted terms={terms} text={value.text} />
        </code>
        {stateInfo ? <StatusBadge title={stateInfo.hint}>{stateInfo.label}</StatusBadge> : null}
        <CopyButton
          ariaLabel={t("common.value.copyOf", { label })}
          label={t("common.value.copy")}
          value={value.text}
        />
      </span>
    );
  }
  if (value.kind === "withheld" || value.kind === "masked") {
    if (load && resetKey !== undefined) {
      return (
        <LazySecretValue
          label={label}
          load={load}
          resetKey={resetKey}
          secret={value.kind === "masked"}
        />
      );
    }
    const note =
      value.kind === "withheld"
        ? t("env.chain.withheld")
        : final
          ? t("env.chain.maskedFinal")
          : t("env.chain.maskedChain");
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <code className="rounded-control bg-surface-muted px-ui-8 py-ui-2 font-mono text-aux">
          <span aria-hidden="true">{SECRET_MASK}</span>
          <span className="sr-only">{note}</span>
        </code>
        <span className="text-meta text-muted-foreground">{note}</span>
      </span>
    );
  }
  return null;
}
