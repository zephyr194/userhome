import { useState } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { SECRET_MASK } from "../../components/ui/secretMask";
import { useT } from "../../i18n/useLocale";
import {
  compareVariableNames,
  type ChainSource,
  type ChainStep,
  type ChainValue,
  type VariableChainRow,
} from "./variableChainModel";
import { LazySecretValue } from "./LazySecretValue";
import { appliesToText, valueStateText } from "./zshModel";

export interface VariableChainTableProps {
  /** Accessible name of the table. */
  label: string;
  rows: readonly VariableChainRow[];
  /** Fetches the final value of a secret or long value; process values never reveal. */
  onRevealFinal: (row: VariableChainRow) => Promise<string>;
  /** Opens the assignment the final value comes from. Absent means read only. */
  onEdit?: (row: VariableChainRow) => void;
  /** Removes the assignment the final value comes from. Absent hides the action. */
  onRemove?: (row: VariableChainRow) => void;
}

const CELL = "min-w-0 px-ui-8 py-ui-4 align-top";
const MONO = "break-all font-mono text-aux";

function sourceText(source: ChainSource): string {
  return source.line === undefined ? source.file : `${source.file}:${source.line}`;
}

function rowKey(row: VariableChainRow): string {
  return `${sourceText(row.final.source)}#${row.name}`;
}

export function VariableChainTable({ label, onEdit, onRemove, onRevealFinal, rows }: VariableChainTableProps) {
  const t = useT();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
            const isOpen = expanded.has(key);
            return (
              <Row
                isOpen={isOpen}
                key={key}
                onEdit={onEdit}
                onRemove={onRemove}
                onRevealFinal={onRevealFinal}
                onToggle={() => toggle(key)}
                row={row}
                rowId={key}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  isOpen,
  onEdit,
  onRemove,
  onRevealFinal,
  onToggle,
  row,
  rowId,
}: {
  isOpen: boolean;
  onEdit?: VariableChainTableProps["onEdit"];
  onRemove?: VariableChainTableProps["onRemove"];
  onRevealFinal: VariableChainTableProps["onRevealFinal"];
  onToggle: () => void;
  row: VariableChainRow;
  rowId: string;
}) {
  const t = useT();
  const { final } = row;
  const count = row.chain.length;
  const detailId = `env-chain-${rowId.replace(/[^\w-]/g, "-")}`;
  return (
    <>
      <tr className="border-t border-line">
        <td className={CELL}>
          <span className="flex min-w-0 flex-wrap items-center gap-ui-4">
            <code className="break-all font-mono text-aux font-semibold">{row.name}</code>
            {final.scope ? (
              <StatusBadge title={appliesToText(final.scope).detail}>
                {appliesToText(final.scope).label}
              </StatusBadge>
            ) : null}
            {final.value.kind === "masked" ? (
              <StatusBadge tone="danger">{t("env.chain.badge.secret")}</StatusBadge>
            ) : null}
            {final.append ? <StatusBadge>{t("env.chain.badge.append")}</StatusBadge> : null}
            {onEdit ? (
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
          <ValueView
            label={row.name}
            load={() => onRevealFinal(row)}
            resetKey={rowId}
            state={final.state}
            value={final.value}
          />
          {row.note ? (
            <span className="mt-ui-4 flex">
              <StatusBadge tone="warning">{t("env.chain.overridden")}</StatusBadge>
            </span>
          ) : null}
        </td>
        <td className={classNames(CELL, MONO, "text-muted-foreground")}>{sourceText(final.source)}</td>
        <td className={CELL}>
          {count > 0 ? (
            <Button
              aria-controls={detailId}
              aria-expanded={isOpen}
              onClick={onToggle}
              size="sm"
              variant="ghost"
            >
              {t("env.chain.expand", { count })}
            </Button>
          ) : null}
        </td>
      </tr>
      {isOpen && count > 0 ? (
        <tr>
          <td className="px-ui-8 pb-ui-8" colSpan={4} id={detailId}>
            <ol aria-label={t("env.chain.steps", { name: row.name })} className="grid gap-ui-4">
              {row.chain.map((step, index) => (
                <StepView key={index} step={step} />
              ))}
              <StepView final step={final} />
            </ol>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StepView({ final = false, step }: { final?: boolean; step: ChainStep }) {
  const t = useT();
  return (
    <li
      className={classNames(
        "flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-8 py-ui-4",
        final && "border-l-2 border-primary",
      )}
    >
      {final ? <StatusBadge>{t("env.chain.badge.final")}</StatusBadge> : null}
      <span className="min-w-0 max-w-full">
        <ValueView final={final} state={step.state} value={step.value} />
      </span>
      <span className={classNames(MONO, "text-muted-foreground")}>{sourceText(step.source)}</span>
      {step.scope ? (
        <StatusBadge title={appliesToText(step.scope).detail}>
          {appliesToText(step.scope).label}
        </StatusBadge>
      ) : null}
    </li>
  );
}

/** Plain text is shown; secrets and long values stay masked unless the caller reveals them. */
function ValueView({
  final = false,
  label,
  load,
  resetKey,
  state,
  value,
}: {
  final?: boolean;
  label?: string;
  load?: () => Promise<string>;
  resetKey?: string;
  state?: ChainStep["state"];
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
        <code className={classNames(MONO)}>{value.text}</code>
        {stateInfo ? <StatusBadge title={stateInfo.hint}>{stateInfo.label}</StatusBadge> : null}
      </span>
    );
  }
  if (value.kind === "withheld" || value.kind === "masked") {
    if (load && label !== undefined && resetKey !== undefined) {
      return <LazySecretValue label={label} load={load} resetKey={resetKey} />;
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
