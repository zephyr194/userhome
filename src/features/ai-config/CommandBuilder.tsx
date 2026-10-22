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
import { Button, Modal } from "../../components/ui";
import { CheckboxField, SelectField, TextField } from "../../components/ui/forms";
import {
  NOTICE_LABELS,
  RISK_CONFIRM_LABEL,
  RISK_LABELS,
  SECRET_NOTE,
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

const EMPTY_HINT = "勾选 flag 或环境变量后，这里会生成可复制的命令。";
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
  return (
    <section aria-label="Claude Code 命令生成" className="grid min-w-0 gap-ui-md">
      <h2 className="m-0 text-body font-semibold">Claude Code 命令生成</h2>
      {options.status === "loading" ? (
        <p role="status" className="m-0 text-aux">
          正在读取 flags 与环境变量…
        </p>
      ) : null}
      {options.status === "failed" ? (
        <div role="alert" className="grid gap-ui-sm">
          <p className="m-0 text-aux">{options.error.message}</p>
          <div>
            <Button variant="ghost" onClick={onRetry}>
              重试
            </Button>
          </div>
        </div>
      ) : null}
      {options.status === "ready" ? (
        <>
          <CoverageNotice summary={options.summary} />
          <p className="m-0 text-aux">{options.summary.coverageNote}</p>
          <TextField
            label="本机版本（可选）"
            description="填写后会检查各项版本要求；留空时版本显示为未确认。"
            value={detectedVersion}
            maxLength={32}
            onValueChange={onVersionChange}
          />
          {options.summary.items.length === 0 ? (
            <p className="m-0 text-aux">没有可显示的 flags 或环境变量。</p>
          ) : (
            <ul className="m-0 grid list-none gap-ui-md p-0">
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
  "grid min-w-0 gap-ui-xs rounded-control bg-surface-muted px-ui-lg py-ui-md";

/**
 * States how much of the official flag and environment list is shown. Missing
 * coverage metadata counts as unknown, which is always treated as partial.
 */
function CoverageNotice({ summary }: { readonly summary: ClaudeOptionSummary }) {
  const { flagsCoverage: flags, envCoverage: env } = summary;
  if (flags === null || env === null) {
    return (
      <div role="note" className={COVERAGE_BOX_CLASS}>
        <p className="m-0 font-semibold">
          ⚠ 收录范围未知，按部分收录处理：官方页面更多，未收录项不可选。
        </p>
      </div>
    );
  }
  const counts = `已收录 ${flags.listedCount} 项 flags / ${env.listedCount} 项环境变量`;
  const complete = flags.snapshotComplete && env.snapshotComplete;
  return (
    <div role="note" className={COVERAGE_BOX_CLASS}>
      <p className="m-0 font-semibold">
        {complete
          ? `✔ 已完整收录：${counts}。`
          : `⚠ 部分收录：${counts}；官方页面更多，未收录项不可选。`}
      </p>
      {flags.coverageNote !== null ? <p className="m-0 text-aux">{flags.coverageNote}</p> : null}
      {env.coverageNote !== null ? <p className="m-0 text-aux">{env.coverageNote}</p> : null}
      <p className="m-0 text-aux">
        官方来源：flags 页面 {flags.sourceUrl}（检索于 {flags.retrievedOn}）；环境变量页面{" "}
        {env.sourceUrl}（检索于 {env.retrievedOn}）。
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
  const relations = relationTexts(item);
  const risks = item.risks.map((risk) => RISK_LABELS[risk]);
  const facts = [
    kindLabel(item),
    VALUE_TYPE_LABELS[item.valueType],
    versionText(item),
    item.secret ? "敏感（仅占位符）" : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <li className="grid min-w-0 gap-ui-xs border-t border-border pt-ui-md">
      {item.generatable ? (
        <CheckboxField
          label={item.id}
          checked={state.checked}
          onCheckedChange={(checked) => onToggle(item.id, checked)}
        />
      ) : (
        <p className="m-0 font-mono text-aux">{item.id}（仅展示，不生成）</p>
      )}
      <p className="m-0 text-aux">{facts.join(" · ")}</p>
      <p className="m-0 text-aux">{item.description}</p>
      {relations.length > 0 ? <p className="m-0 text-aux">{relations.join("；")}</p> : null}
      {item.configAlternative !== null ? (
        <p className="m-0 text-aux">配置替代项：{item.configAlternative}</p>
      ) : null}
      {risks.length > 0 ? (
        <p role="note" className="m-0 text-aux">
          [风险] {risks.join("、")}
        </p>
      ) : null}
      {item.secret && item.generatable ? (
        <p role="note" className="m-0 text-aux">
          {SECRET_NOTE}
        </p>
      ) : null}
      {state.checked && needsValueInput(item) && item.valueType === "enum" ? (
        <SelectField<string>
          label="取值"
          value={state.value}
          options={[
            { value: "", label: "请选择" },
            ...item.allowedValues.map((value) => ({ value, label: value })),
          ]}
          onValueChange={(value) => onValueChange(item.id, value)}
        />
      ) : null}
      {state.checked && needsValueInput(item) && item.valueType !== "enum" ? (
        <TextField
          label="取值"
          value={state.value}
          maxLength={MAX_VALUE_LENGTH}
          onValueChange={(value) => onValueChange(item.id, value)}
        />
      ) : null}
      {state.checked && risks.length > 0 ? (
        <CheckboxField
          label={RISK_CONFIRM_LABEL}
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
        正在生成命令…
      </p>
    );
  }
  if (preview.status === "failed") {
    return (
      <p role="alert" className="m-0 text-aux">
        {preview.error.message}
      </p>
    );
  }
  const { built } = preview;
  return (
    <div className="grid min-w-0 gap-ui-sm">
      <pre
        aria-label="生成的命令"
        className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-muted px-ui-lg py-ui-md font-mono text-aux"
      >
        {built.text}
      </pre>
      <div className="flex flex-wrap items-center gap-ui-sm">
        <Button variant="ghost" onClick={() => onCopy(built.text)}>
          复制命令
        </Button>
        {copyMessage !== null ? <span role="status" className="text-aux">{copyMessage}</span> : null}
      </div>
      {built.placeholders.length > 0 ? (
        <p role="note" className="m-0 text-aux">
          {SECRET_NOTE}
        </p>
      ) : null}
      {built.notices.length > 0 ? (
        <ul className="m-0 grid list-none gap-ui-xs p-0 text-aux">
          {built.notices.map((notice) => (
            <li key={notice.id}>
              {notice.id}：{NOTICE_LABELS[notice.status]}。{notice.message}
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
  const blockReason = terminalBlockReason(preview);

  const busy = terminal.status === "opening";
  return (
    <div className="grid min-w-0 gap-ui-sm">
      <div className="flex flex-wrap items-center gap-ui-sm">
        <Button disabled={blockReason !== null || busy} onClick={onRequest}>
          在终端打开
        </Button>
      </div>
      {blockReason !== null ? (
        <p role="note" className="m-0 text-aux">
          无法在终端打开：{blockReason}
        </p>
      ) : null}
      {terminal.status === "opened" ? (
        <p role="status" className="m-0 text-aux">
          已在 Terminal 中打开命令。请在 Terminal 窗口中查看并按回车运行；UserHome 不会运行或读取输出。
        </p>
      ) : null}
      {terminal.status === "failed" ? (
        <p role="alert" className="m-0 text-danger">
          {terminal.error.message}
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
  return (
    <Modal
      busy={busy}
      footer={
        <>
          <Button data-modal-cancel disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            在 Terminal 中打开
          </Button>
        </>
      }
      onClose={onCancel}
      open
      title="在终端中打开命令"
    >
      <div className="grid min-w-0 gap-ui-md">
        <p className="m-0 text-aux">
          将在 Terminal 中打开这条命令，需要你在终端里按回车才会运行；UserHome 不会运行或读取输出。
        </p>
        <p className="m-0 text-aux">工作目录：用户主目录（未选择项目目录）。</p>
        <pre
          aria-label="将在终端中运行的命令"
          className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-muted px-ui-lg py-ui-md font-mono text-aux"
        >
          {built.text}
        </pre>
        {built.placeholders.length > 0 ? (
          <p role="note" className="m-0 text-aux">
            命令含占位符，占位符需要你在终端环境中已设置。
          </p>
        ) : null}
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
        ? planRequest(options.summary.items, selection, detectedVersion)
        : null,
    [options, selection, detectedVersion],
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
    if (plan.status === "empty") return { status: "idle", message: EMPTY_HINT };
    if (plan.status === "incomplete") return { status: "idle", message: plan.message };
    const key = JSON.stringify(plan.request);
    if (result === null || result.key !== key) return { status: "loading" };
    return result.outcome.ok
      ? { status: "ready", built: result.outcome.built }
      : { status: "failed", error: result.outcome.error };
  }, [plan, result]);

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
      setCopyMessage("无法复制命令。请检查系统剪贴板权限后重试。");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setCopyMessage("命令已复制到剪贴板。"),
      () => setCopyMessage("无法复制命令。请检查系统剪贴板权限后重试。"),
    );
  }, []);

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
