import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildClaudeCommand,
  getClaudeOptions,
  openClaudeCommandInTerminal,
  type ClaudeBuiltCommand,
  type ClaudeOptionItem,
  type ClaudeOptionSummary,
} from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import { Button, Modal } from "../../components/ui";
import { CheckboxField, SelectField, TextField } from "../../components/ui/forms";
import {
  NOTICE_LABELS,
  RISK_CONFIRM_LABEL_KEY,
  RISK_LABELS,
  SECRET_NOTE_KEY,
  VALUE_TYPE_LABELS,
  kindLabel,
  needsValueInput,
  planRequest,
  relationTexts,
  selectionOf,
  updateItem,
  versionText,
  type RequestPlan,
  type Selection,
  type ItemSelection,
} from "./commandBuilderModel";
import {
  TERMINAL_IDLE,
  reduceTerminalOpen,
  terminalBlockReason,
  type TerminalOpenEvent,
  type TerminalOpenState,
} from "./terminalOpenModel";

export type CommandOptionsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly summary: ClaudeOptionSummary }
  | { readonly status: "failed"; readonly error: AppError };

export type CommandPreview =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly built: ClaudeBuiltCommand }
  | { readonly status: "failed"; readonly error: AppError };

const EMPTY_HINT_KEY = "aiConfig.cmd.emptyHint";
const MAX_VALUE_LENGTH = 8192;

interface CommandBuilderViewProps {
  readonly options: CommandOptionsState;
  readonly selection: Selection;
  readonly detectedVersion: string;
  readonly preview: CommandPreview;
  readonly copyMessage: string | null;
  readonly terminalControl?: ReactNode;
  readonly onToggle: (id: string, checked: boolean) => void;
  readonly onValueChange: (id: string, value: string) => void;
  readonly onAcknowledge: (id: string, acknowledged: boolean) => void;
  readonly onVersionChange: (value: string) => void;
  readonly onCopy: (text: string) => void;
  readonly onRetry: () => void;
}

export function CommandBuilderView({
  options,
  selection,
  detectedVersion,
  preview,
  copyMessage,
  terminalControl,
  onToggle,
  onValueChange,
  onAcknowledge,
  onVersionChange,
  onCopy,
  onRetry,
}: CommandBuilderViewProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <section aria-label={t("aiConfig.cmd.heading")} className="grid min-w-0 gap-ui-8">
      <h2 className="m-0 text-body font-semibold">{t("aiConfig.cmd.heading")}</h2>
      {options.status === "loading" ? (
        <p role="status" className="m-0 text-aux">
          {t("aiConfig.cmd.loading")}
        </p>
      ) : null}
      {options.status === "failed" ? (
        <div role="alert" className="grid gap-ui-8">
          <p className="m-0 text-aux">{localizeError(options.error, locale)}</p>
          <div>
            <Button variant="ghost" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      ) : null}
      {options.status === "ready" ? (
        <>
          <CoverageNotice summary={options.summary} />
          <p className="m-0 text-aux">{options.summary.coverageNote}</p>
          <TextField
            label={t("aiConfig.cmd.versionLabel")}
            description={t("aiConfig.cmd.versionDescription")}
            value={detectedVersion}
            maxLength={32}
            onValueChange={onVersionChange}
          />
          {options.summary.items.length === 0 ? (
            <p className="m-0 text-aux">{t("aiConfig.cmd.noItems")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-ui-8 p-0">
              {options.summary.items.map((item) => (
                <OptionRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  state={selectionOf(selection, item.id)}
                  onToggle={onToggle}
                  onValueChange={onValueChange}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </ul>
          )}
          <PreviewPanel preview={preview} copyMessage={copyMessage} onCopy={onCopy} />
          {terminalControl ?? null}
        </>
      ) : null}
    </section>
  );
}

const COVERAGE_BOX_CLASS =
  "grid min-w-0 gap-ui-4 rounded-control bg-surface-muted px-ui-8 py-ui-8";

/**
 * States how much of the official flag and environment list is shown. Missing
 * coverage metadata counts as unknown, which is always treated as partial.
 */
function CoverageNotice({ summary }: { readonly summary: ClaudeOptionSummary }) {
  const t = useT();
  const { flagsCoverage: flags, envCoverage: env } = summary;
  if (flags === null || env === null) {
    return (
      <div role="note" className={COVERAGE_BOX_CLASS}>
        <p className="m-0 font-semibold">
          {t("aiConfig.cmd.coverageUnknown")}
        </p>
      </div>
    );
  }
  const counts = t("aiConfig.cmd.coverageCounts", {
    flags: flags.listedCount,
    env: env.listedCount,
  });
  const complete = flags.snapshotComplete && env.snapshotComplete;
  return (
    <div role="note" className={COVERAGE_BOX_CLASS}>
      <p className="m-0 font-semibold">
        {complete
          ? t("aiConfig.cmd.coverageComplete", { counts })
          : t("aiConfig.cmd.coveragePartial", { counts })}
      </p>
      {flags.coverageNote !== null ? <p className="m-0 text-aux">{flags.coverageNote}</p> : null}
      {env.coverageNote !== null ? <p className="m-0 text-aux">{env.coverageNote}</p> : null}
      <p className="m-0 text-aux">
        {t("aiConfig.cmd.coverageSource", {
          flagsUrl: flags.sourceUrl,
          flagsDate: flags.retrievedOn,
          envUrl: env.sourceUrl,
          envDate: env.retrievedOn,
        })}
      </p>
    </div>
  );
}

interface OptionRowProps {
  readonly item: ClaudeOptionItem;
  readonly state: ItemSelection;
  readonly onToggle: (id: string, checked: boolean) => void;
  readonly onValueChange: (id: string, value: string) => void;
  readonly onAcknowledge: (id: string, acknowledged: boolean) => void;
}

function OptionRow({ item, state, onToggle, onValueChange, onAcknowledge }: OptionRowProps) {
  const t = useT();
  const relations = relationTexts(item, t);
  const risks = item.risks.map((risk) => t(RISK_LABELS[risk]));
  const facts = [
    kindLabel(item, t),
    t(VALUE_TYPE_LABELS[item.valueType]),
    versionText(item, t),
    item.secret ? t("aiConfig.cmd.secretFact") : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <li className="grid min-w-0 gap-ui-4 border-t border-border pt-ui-8">
      {item.generatable ? (
        <CheckboxField
          label={item.id}
          checked={state.checked}
          onCheckedChange={(checked) => onToggle(item.id, checked)}
        />
      ) : (
        <p className="m-0 font-mono text-aux">{t("aiConfig.cmd.displayOnlyItem", { id: item.id })}</p>
      )}
      <p className="m-0 text-aux">{facts.join(" · ")}</p>
      <p className="m-0 text-aux">{item.description}</p>
      {relations.length > 0 ? (
        <p className="m-0 text-aux">{relations.join(t("aiConfig.cmd.joinRelations"))}</p>
      ) : null}
      {item.configAlternative !== null ? (
        <p className="m-0 text-aux">
          {t("aiConfig.cmd.configAlternative", { value: item.configAlternative })}
        </p>
      ) : null}
      {risks.length > 0 ? (
        <p role="note" className="m-0 text-aux">
          {t("aiConfig.cmd.riskList", { risks: risks.join(t("aiConfig.listSeparator")) })}
        </p>
      ) : null}
      {item.secret && item.generatable ? (
        <p role="note" className="m-0 text-aux">
          {t(SECRET_NOTE_KEY)}
        </p>
      ) : null}
      {state.checked && needsValueInput(item) && item.valueType === "enum" ? (
        <SelectField<string>
          label={t("aiConfig.edit.valueLabel")}
          value={state.value}
          options={[
            { value: "", label: t("aiConfig.edit.choose") },
            ...item.allowedValues.map((value) => ({ value, label: value })),
          ]}
          onValueChange={(value) => onValueChange(item.id, value)}
        />
      ) : null}
      {state.checked && needsValueInput(item) && item.valueType !== "enum" ? (
        <TextField
          label={t("aiConfig.edit.valueLabel")}
          value={state.value}
          maxLength={MAX_VALUE_LENGTH}
          onValueChange={(value) => onValueChange(item.id, value)}
        />
      ) : null}
      {state.checked && risks.length > 0 ? (
        <CheckboxField
          label={t(RISK_CONFIRM_LABEL_KEY)}
          checked={state.acknowledged}
          onCheckedChange={(acknowledged) => onAcknowledge(item.id, acknowledged)}
        />
      ) : null}
    </li>
  );
}

function PreviewPanel({
  preview,
  copyMessage,
  onCopy,
}: {
  readonly preview: CommandPreview;
  readonly copyMessage: string | null;
  readonly onCopy: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (preview.status === "idle") {
    return (
      <p role="status" className="m-0 text-aux">
        {preview.message}
      </p>
    );
  }
  if (preview.status === "loading") {
    return (
      <p role="status" className="m-0 text-aux">
        {t("aiConfig.terminal.generating")}
      </p>
    );
  }
  if (preview.status === "failed") {
    return (
      <p role="alert" className="m-0 text-aux">
        {localizeError(preview.error, locale)}
      </p>
    );
  }
  const { built } = preview;
  return (
    <div className="grid min-w-0 gap-ui-8">
      <pre
        aria-label={t("aiConfig.cmd.commandLabel")}
        className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-muted px-ui-8 py-ui-8 font-mono text-aux"
      >
        {built.text}
      </pre>
      <div className="flex flex-wrap items-center gap-ui-8">
        <Button variant="ghost" onClick={() => onCopy(built.text)}>
          {t("aiConfig.cmd.copy")}
        </Button>
        {copyMessage !== null ? <span role="status" className="text-aux">{copyMessage}</span> : null}
      </div>
      {built.placeholders.length > 0 ? (
        <p role="note" className="m-0 text-aux">
          {t(SECRET_NOTE_KEY)}
        </p>
      ) : null}
      {built.notices.length > 0 ? (
        <ul className="m-0 grid list-none gap-ui-4 p-0 text-aux">
          {built.notices.map((notice) => (
            <li key={notice.id}>
              {t("aiConfig.cmd.noticeRow", {
                id: notice.id,
                status: t(NOTICE_LABELS[notice.status]),
                message: notice.message,
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface TerminalOpenControlProps {
  readonly preview: CommandPreview;
  readonly terminal: TerminalOpenState;
  readonly onRequest: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function TerminalOpenControl({
  preview,
  terminal,
  onRequest,
  onCancel,
  onConfirm,
}: TerminalOpenControlProps) {
  const t = useT();
  const locale = useLocale();
  const blockReason = terminalBlockReason(preview, t);

  const busy = terminal.status === "opening";
  return (
    <div className="grid min-w-0 gap-ui-8">
      <div className="flex flex-wrap items-center gap-ui-8">
        <Button disabled={blockReason !== null || busy} onClick={onRequest}>
          {t("aiConfig.terminal.open")}
        </Button>
      </div>
      {blockReason !== null ? (
        <p role="note" className="m-0 text-aux">
          {t("aiConfig.terminal.blocked", { reason: blockReason })}
        </p>
      ) : null}
      {terminal.status === "opened" ? (
        <p role="status" className="m-0 text-aux">
          {t("aiConfig.terminal.opened")}
        </p>
      ) : null}
      {terminal.status === "failed" ? (
        <p role="alert" className="m-0 text-danger">
          {localizeError(terminal.error, locale)}
        </p>
      ) : null}
      {(terminal.status === "confirming" || terminal.status === "opening") &&
      preview.status === "ready" ? (
        <TerminalConfirmDialog built={preview.built} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
      ) : null}
    </div>
  );
}

function TerminalConfirmDialog({
  built,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly built: ClaudeBuiltCommand;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Modal
      busy={busy}
      footer={
        <>
          <Button data-modal-cancel disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            {t("aiConfig.terminal.confirm")}
          </Button>
        </>
      }
      onClose={onCancel}
      open
      title={t("aiConfig.terminal.dialogTitle")}
    >
      <div className="grid min-w-0 gap-ui-8">
        <p className="m-0 text-aux">
          {t("aiConfig.terminal.dialogBody")}
        </p>
        <p className="m-0 text-aux">{t("aiConfig.terminal.workingDirectory")}</p>
        <pre
          aria-label={t("aiConfig.terminal.commandLabel")}
          className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-muted px-ui-8 py-ui-8 font-mono text-aux"
        >
          {built.text}
        </pre>
      </div>
    </Modal>
  );
}

type CommandResult =
  | { readonly ok: true; readonly built: ClaudeBuiltCommand }
  | { readonly ok: false; readonly error: AppError };

/**
 * Loads the flag and environment catalogue and builds the copyable command. Only
 * the newest request may update the view, and nothing is stored in browser storage.
 */
export function CommandBuilder() {
  const t = useT();
  const [options, setOptions] = useState<CommandOptionsState>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>({});
  const [detectedVersion, setDetectedVersion] = useState("");
  const [result, setResult] = useState<{ readonly key: string; readonly outcome: CommandResult } | null>(
    null,
  );
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const loadCounter = useRef(0);
  const buildCounter = useRef(0);

  const load = useCallback(() => {
    const requestId = ++loadCounter.current;
    getClaudeOptions().then(
      (summary) => {
        if (requestId === loadCounter.current) setOptions({ status: "ready", summary });
      },
      (error: unknown) => {
        if (requestId === loadCounter.current) {
          setOptions({ status: "failed", error: decodeAppError(error) });
        }
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(() => {
    setOptions({ status: "loading" });
    load();
  }, [load]);

  const plan = useMemo<RequestPlan | null>(
    () =>
      options.status === "ready"
        ? planRequest(options.summary.items, selection, detectedVersion, t)
        : null,
    [options, selection, detectedVersion, t],
  );

  useEffect(() => {
    const requestId = ++buildCounter.current;
    if (plan?.status !== "ready") return;
    const key = JSON.stringify(plan.request);
    buildClaudeCommand(plan.request).then(
      (built) => {
        if (requestId === buildCounter.current) {
          setResult({ key, outcome: { ok: true, built } });
        }
      },
      (error: unknown) => {
        if (requestId === buildCounter.current) {
          setResult({ key, outcome: { ok: false, error: decodeAppError(error) } });
        }
      },
    );
  }, [plan]);

  const preview = useMemo<CommandPreview>(() => {
    if (plan === null) return { status: "loading" };
    if (plan.status === "empty") return { status: "idle", message: t(EMPTY_HINT_KEY) };
    if (plan.status === "incomplete") return { status: "idle", message: plan.message };
    const key = JSON.stringify(plan.request);
    if (result === null || result.key !== key) return { status: "loading" };
    return result.outcome.ok
      ? { status: "ready", built: result.outcome.built }
      : { status: "failed", error: result.outcome.error };
  }, [plan, result, t]);

  const planKey = plan?.status === "ready" ? JSON.stringify(plan.request) : null;
  const [terminalRecord, setTerminalRecord] = useState<{
    readonly key: string | null;
    readonly state: TerminalOpenState;
  }>({ key: null, state: TERMINAL_IDLE });
  const terminal = terminalRecord.key === planKey ? terminalRecord.state : TERMINAL_IDLE;

  const applyTerminal = useCallback((key: string | null, event: TerminalOpenEvent) => {
    setTerminalRecord((current) => ({
      key,
      state: reduceTerminalOpen(current.key === key ? current.state : TERMINAL_IDLE, event),
    }));
  }, []);

  const confirmTerminal = useCallback(() => {
    if (plan?.status !== "ready") return;
    const key = JSON.stringify(plan.request);
    applyTerminal(key, { type: "confirm" });
    openClaudeCommandInTerminal(plan.request).then(
      () => applyTerminal(key, { type: "succeeded" }),
      (error: unknown) => applyTerminal(key, { type: "failed", error: decodeAppError(error) }),
    );
  }, [plan, applyTerminal]);

  const copy = useCallback((text: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage(t("aiConfig.cmd.copyFailed"));
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setCopyMessage(t("aiConfig.cmd.copied")),
      () => setCopyMessage(t("aiConfig.cmd.copyFailed")),
    );
  }, [t]);

  return (
    <CommandBuilderView
      options={options}
      selection={selection}
      detectedVersion={detectedVersion}
      preview={preview}
      copyMessage={copyMessage}
      terminalControl={
        <TerminalOpenControl
          preview={preview}
          terminal={terminal}
          onRequest={() => applyTerminal(planKey, { type: "request" })}
          onCancel={() => applyTerminal(planKey, { type: "cancel" })}
          onConfirm={confirmTerminal}
        />
      }
      onToggle={(id, checked) =>
        setSelection((current) => updateItem(current, id, { checked }))
      }
      onValueChange={(id, value) =>
        setSelection((current) => updateItem(current, id, { value }))
      }
      onAcknowledge={(id, acknowledged) =>
        setSelection((current) => updateItem(current, id, { acknowledged }))
      }
      onVersionChange={setDetectedVersion}
      onCopy={copy}
      onRetry={retry}
    />
  );
}
