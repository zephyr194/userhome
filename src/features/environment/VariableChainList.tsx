import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge, TextField } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { CopyButton } from "../../components/ui/CopyButton";
import { SECRET_MASK } from "../../components/ui/secretMask";
import { useT } from "../../i18n/useLocale";
import type { TranslateFunction } from "../../i18n";
import {
  compareVariableNames,
  type ChainSource,
  type ChainStep,
  type ChainValue,
  type Effective,
  type VariableChainRow,
} from "./variableChainModel";
import {
  MAX_QUERY_LENGTH,
  filterVariables,
  highlightParts,
  queryTerms,
  recalledQuery,
  rememberQuery,
} from "./variableSearch";
import { LazySecretValue } from "./LazySecretValue";
import { appliesToText, valueStateText } from "./zshModel";

export interface VariableChainListProps {
  /** Accessible name of the variable list. */
  label: string;
  rows: readonly VariableChainRow[];
  /** Fetches the final value of a secret or long value; process values never reveal. */
  onRevealFinal: (row: VariableChainRow) => Promise<string>;
  /** Opens the assignment the final value comes from. Absent means read only. */
  onEdit?: (row: VariableChainRow) => void;
  /** Removes the assignment the final value comes from. Absent hides the action. */
  onRemove?: (row: VariableChainRow) => void;
  /** Keys the search words in page memory, so they survive switching tabs. */
  searchKey: string;
  /** Controls shown next to the search field, such as the file filter. */
  filter?: ReactNode;
  /** Shown instead of the list when there are no variables at all. */
  emptyState?: ReactNode;
}

interface VariablePanesProps extends Omit<VariableChainListProps, "searchKey" | "filter" | "emptyState"> {
  terms: readonly string[];
}

const MONO = "break-all font-mono text-aux";
const ROW_BUTTON =
  "flex w-full min-w-0 flex-col items-start gap-ui-4 rounded-control px-ui-8 py-ui-4 text-left hover:bg-surface-muted";

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

/** Search field, count, then the variable list beside the selected variable's details. */
export function VariableChainList({
  emptyState,
  filter,
  rows,
  searchKey,
  ...paneProps
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
        <VariablePanes {...paneProps} rows={matched} terms={terms} />
      )}
    </div>
  );
}

/**
 * The list keeps the variable names in one column and the selected variable's
 * final value, source and read chain in the other, the same split as the
 * services and AI config pages. Narrow screens stack the details under the list.
 */
function VariablePanes({ label, onEdit, onRemove, onRevealFinal, rows, terms }: VariablePanesProps) {
  const t = useT();
  const sorted = [...rows].sort(compareVariableNames);
  const [picked, setPicked] = useState<string>();
  const selected = sorted.find((row) => rowKey(row) === picked) ?? sorted[0];
  if (selected === undefined) return null;
  const selectedKey = rowKey(selected);

  return (
    <div className="grid min-w-0 gap-ui-12 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-ui-16">
      <section aria-label={label} className="min-w-0 sm:border-r sm:border-line">
        <ul className="grid max-h-96 min-w-0 gap-ui-4 overflow-y-auto overscroll-contain">
          {sorted.map((row) => {
            const key = rowKey(row);
            const active = key === selectedKey;
            return (
              <li key={key}>
                <Button
                  aria-current={active ? "true" : undefined}
                  className={classNames(ROW_BUTTON, active && "bg-surface-muted")}
                  onClick={() => setPicked(key)}
                  variant="ghost"
                >
                  <code className="max-w-full break-all font-mono text-aux font-semibold">
                    <Highlighted terms={terms} text={row.name} />
                  </code>{" "}
                  <span className="max-w-full break-all text-meta text-muted-foreground">
                    {row.definedIn !== undefined
                      ? t("env.chain.definedIn", { count: row.definedIn })
                      : sourceText(row.final.source)}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label={t("env.chain.detail.region")} className="min-w-0">
        <VariableDetail
          key={selectedKey}
          onEdit={onEdit}
          onRemove={onRemove}
          onRevealFinal={onRevealFinal}
          row={selected}
          terms={terms}
        />
      </section>
    </div>
  );
}

function VariableDetail({
  onEdit,
  onRemove,
  onRevealFinal,
  row,
  terms,
}: {
  onEdit?: VariableChainListProps["onEdit"];
  onRemove?: VariableChainListProps["onRemove"];
  onRevealFinal: VariableChainListProps["onRevealFinal"];
  row: VariableChainRow;
  terms: readonly string[];
}) {
  const t = useT();
  const { final } = row;
  const merged = row.definedIn !== undefined;
  const headingId = `env-chain-${rowKey(row).replace(/[^\w-]/g, "-")}`;
  const editable = !merged && onEdit !== undefined;
  return (
    <article aria-labelledby={headingId} className="grid min-w-0 gap-ui-12">
      <header className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <h3 className="min-w-0 break-all font-mono text-group font-semibold" id={headingId}>
          <Highlighted terms={terms} text={row.name} />
        </h3>
        {!merged && final.scope ? (
          <StatusBadge title={appliesToText(final.scope).detail}>
            {appliesToText(final.scope).label}
          </StatusBadge>
        ) : null}
        {!merged && final.value.kind === "masked" ? (
          <StatusBadge tone="danger">{t("env.chain.badge.secret")}</StatusBadge>
        ) : null}
        {!merged && final.append ? <StatusBadge>{t("env.chain.badge.append")}</StatusBadge> : null}
        {editable ? (
          <Button aria-label={t("env.chain.edit", { name: row.name })} onClick={() => onEdit(row)} variant="ghost">
            {t("env.chain.editButton")}
          </Button>
        ) : null}
        {onRemove ? (
          <Button aria-label={t("env.chain.remove", { name: row.name })} onClick={() => onRemove(row)} variant="ghost">
            {t("env.chain.removeButton")}
          </Button>
        ) : null}
      </header>
      {merged ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t("env.chain.mergedNote")}</p>
      ) : (
        <FinalValue
          label={row.name}
          load={() => onRevealFinal(row)}
          resetKey={headingId}
          final={final}
          note={row.note}
          terms={terms}
        />
      )}
      {!merged ? (
        <p className="grid gap-ui-4">
          <span className="text-meta text-muted-foreground">{t("env.chain.source")}</span>
          <span className={classNames(MONO, "text-muted-foreground")}>
            <Highlighted terms={terms} text={sourceText(final.source)} />
          </span>
        </p>
      ) : null}
      {row.chain.length > 0 ? (
        <section aria-labelledby={`${headingId}-chain`} className="grid min-w-0 gap-ui-8">
          <h4 className="text-aux font-semibold" id={`${headingId}-chain`}>
            {merged ? t("env.chain.definedHeading") : t("env.chain.chainHeading")}
          </h4>
          <ol aria-label={t("env.chain.steps", { name: row.name })} className="grid gap-ui-4">
            {row.chain.map((step, index) => (
              <StepView key={index} name={row.name} step={step} terms={terms} />
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

/**
 * The value that takes effect. A reference the reader can expand shows the
 * expanded text with the written value beneath it; one it cannot expand shows the
 * written value and says why. Secrets and long values stay withheld until loaded.
 */
function FinalValue({
  final,
  label,
  load,
  note,
  resetKey,
  terms,
}: {
  final: ChainStep;
  label: string;
  load: () => Promise<string>;
  note?: string;
  resetKey: string;
  terms: readonly string[];
}) {
  const t = useT();
  const effective = final.effective;
  const expanded =
    effective?.kind === "text" && final.value.kind === "text" && effective.text !== final.value.text;
  const shown: ChainValue =
    effective?.kind === "text" && final.value.kind === "text"
      ? { kind: "text", text: effective.text }
      : final.value;
  const unresolved = effective?.kind === "unresolved" ? effective : undefined;
  return (
    <section aria-labelledby={`${resetKey}-final`} className="grid min-w-0 gap-ui-8">
      <h4 className="text-aux font-semibold" id={`${resetKey}-final`}>
        {t("env.chain.effective.heading")}
      </h4>
      <ValueView
        label={label}
        load={load}
        resetKey={resetKey}
        final
        state={expanded ? undefined : final.state}
        terms={terms}
        value={shown}
      />
      {expanded ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("env.chain.effective.expanded", { raw: final.value.kind === "text" ? final.value.text : "" })}
        </p>
      ) : null}
      {unresolved ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{unresolvedText(unresolved, t)}</p>
      ) : null}
      {note ? (
        <span className="flex">
          <StatusBadge tone="warning">{note}</StatusBadge>
        </span>
      ) : null}
    </section>
  );
}

function unresolvedText(
  effective: Extract<Effective, { kind: "unresolved" }>,
  t: TranslateFunction,
): string {
  const names = effective.names.join(t("env.chain.listSeparator"));
  switch (effective.reason) {
    case "reference":
      return t("env.chain.effective.unresolved.reference", { names });
    case "hidden":
      return t("env.chain.effective.unresolved.hidden", { names });
    case "dynamic":
      return t("env.chain.effective.unresolved.dynamic");
    case "append":
      return t("env.chain.effective.unresolved.append");
    case "complex":
      return t("env.chain.effective.unresolved.complex");
  }
}

function StepView({
  name,
  step,
  terms,
}: {
  name: string;
  step: ChainStep;
  terms: readonly string[];
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-8 py-ui-4">
      <span className="min-w-0 max-w-full">
        <ValueView label={name} state={step.state} terms={terms} value={step.value} />
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
