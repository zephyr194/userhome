import { useEffect, useState } from "react";
import { Button, Panel, TextAreaField } from "../../components/ui";
import {
  caddyCancelValidate,
  caddyLoadRaw,
  caddySaveRaw,
  caddyValidate,
  isWorkdirRequired,
  type CaddyRawOrigin,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { SaveState } from "./CaddySaveBar";
import {
  isResultStale,
  isRunning,
  summarizeFailure,
  summarizeReport,
  type SummaryTone,
  type ValidationState,
  type ValidationSummary,
} from "./rawEditorFlow";

export type RawLoadState =
  | { status: "loading" }
  | { status: "ready"; origin: CaddyRawOrigin }
  | { status: "failed"; error: AppError };

const TONE_CLASS: Record<SummaryTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

interface RawEditorViewProps {
  hidden?: boolean;
  blockReason?: string;
  text: string;
  load: RawLoadState;
  validation: ValidationState;
  save: SaveState;
  onTextChange: (text: string) => void;
  onValidate: () => void;
  onAllowExternalAndValidate: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function RawEditorView({
  hidden = false,
  blockReason,
  text,
  load,
  validation,
  save,
  onTextChange,
  onValidate,
  onAllowExternalAndValidate,
  onCancel,
  onSave,
}: RawEditorViewProps) {
  const loading = load.status === "loading";
  const blocked = blockReason !== undefined;
  const running = isRunning(validation);
  const saving = save.status === "saving";
  const saveBlocked = loading || load.status === "failed" || saving || blocked;
  const result = resultSummary(validation);
  const stale = isResultStale(validation, text);
  const canAllow = result?.canAllowExternal === true && !allowedAlready(validation);

  return (
    <section
      hidden={hidden}
      aria-labelledby="raw-editor-heading"
      className="grid min-w-0 gap-ui-lg"
    >
      <Panel className="grid gap-ui-sm p-ui-lg">
        <h2 id="raw-editor-heading" className="text-sm font-semibold">
          原文 Caddyfile
        </h2>
        <p className="m-0 text-aux text-muted-foreground">
          原文按原样保存和校验，不会被表单重写，也不会转换为表单规则。未识别的指令和注释保持原样。
        </p>
        <p role="note" className="m-0 text-aux text-warning">
          校验不是纯解析：validate 会加载（provision）配置中的模块，可能占用资源并与正在运行的实例争用端口。
        </p>
        {load.status === "failed" ? (
          <p role="alert" className="m-0 text-body text-danger">
            无法读取已保存的原文：{load.error.message} 保存已停用，以免覆盖现有文件。
          </p>
        ) : null}
        {blockReason !== undefined ? (
          <p role="status" className="m-0 text-body text-muted-foreground">
            {blockReason}后才能读取、校验或保存原文。
          </p>
        ) : null}
        {loading && !blocked ? (
          <p role="status" className="m-0 text-body text-muted-foreground">
            正在读取已保存的原文……
          </p>
        ) : null}
        <TextAreaField
          label="Caddyfile 原文"
          value={text}
          rows={18}
          spellCheck={false}
          disabled={loading || blocked}
          inputClassName="font-mono text-body"
          onValueChange={onTextChange}
        />
        <div className="flex flex-wrap items-center gap-ui-sm">
          <Button
            variant="primary"
            disabled={loading || running || blocked}
            onClick={onValidate}
          >
            校验
          </Button>
          {running ? (
            <Button variant="secondary" onClick={onCancel}>
              取消校验
            </Button>
          ) : null}
          {canAllow ? (
            <Button
              variant="secondary"
              disabled={running || blocked}
              onClick={onAllowExternalAndValidate}
            >
              允许外部引用并校验
            </Button>
          ) : null}
          <Button variant="secondary" disabled={saveBlocked} onClick={onSave}>
            {saving ? "保存中……" : "保存原文"}
          </Button>
        </div>
        <SaveResult state={save} />
      </Panel>
      <ValidationResult
        validation={validation}
        summary={result}
        stale={stale}
      />
    </section>
  );
}

function resultSummary(validation: ValidationState): ValidationSummary | undefined {
  if (validation.status === "done") return summarizeReport(validation.report);
  if (validation.status === "failed") return summarizeFailure(validation.error);
  return undefined;
}

function allowedAlready(validation: ValidationState): boolean {
  return (
    (validation.status === "done" || validation.status === "running") &&
    validation.allowExternalReferences
  );
}

function ValidationResult({
  validation,
  summary,
  stale,
}: {
  validation: ValidationState;
  summary: ValidationSummary | undefined;
  stale: boolean;
}) {
  if (validation.status === "running") {
    return (
      <Panel role="status" aria-live="polite" className="grid gap-ui-sm p-ui-lg">
        <p className="m-0 text-body">正在校验……可随时取消。</p>
      </Panel>
    );
  }
  if (!summary) return null;
  return (
    <Panel aria-labelledby="raw-validation-heading" className="grid gap-ui-sm p-ui-lg">
      <h3 id="raw-validation-heading" className={`m-0 text-sm font-semibold ${TONE_CLASS[summary.tone]}`}>
        {summary.title}
      </h3>
      {stale ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          文本已修改，以下结果针对之前校验的内容。
        </p>
      ) : null}
      {summary.details.length > 0 ? (
        <ul className="m-0 grid gap-ui-xs pl-ui-lg text-body">
          {summary.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function SaveResult({ state }: { state: SaveState }) {
  if (state.status === "saved") {
    return (
      <p role="status" className="m-0 text-body text-success">
        原文已保存。保存不会启动或重载 Caddy。
      </p>
    );
  }
  if (state.status !== "failed") return null;
  return (
    <p role="alert" className="m-0 text-body text-danger">
      保存失败：{state.error.message}
    </p>
  );
}

const EMPTY_LOAD: RawLoadState = { status: "loading" };

interface RawEditorProps {
  hidden?: boolean;
  workdirReason?: string;
  onWorkdirRequired: () => void;
}

export function RawEditor({ hidden = false, workdirReason, onWorkdirRequired }: RawEditorProps) {
  const [text, setText] = useState("");
  const [load, setLoad] = useState<RawLoadState>(EMPTY_LOAD);
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const workdirReady = workdirReason === undefined;

  useEffect(() => {
    if (!workdirReady) return;
    let active = true;
    caddyLoadRaw().then(
      (document) => {
        if (!active) return;
        setText(document.text);
        setLoad({ status: "ready", origin: document.origin });
      },
      (error: AppError) => {
        if (!active) return;
        if (isWorkdirRequired(error)) {
          setLoad(EMPTY_LOAD);
          onWorkdirRequired();
          return;
        }
        setLoad({ status: "failed", error });
      },
    );
    return () => {
      active = false;
    };
  }, [workdirReady, onWorkdirRequired]);

  function changeText(next: string) {
    setText(next);
    setSave((current) => (current.status === "saving" ? current : { status: "idle" }));
  }

  function runValidation(allowExternalReferences: boolean) {
    const checkedText = text;
    const runId = crypto.randomUUID();
    setValidation({ status: "running", runId, allowExternalReferences, checkedText });
    caddyValidate({ text: checkedText, runId, allowExternalReferences }).then(
      (report) =>
        setValidation({ status: "done", report, allowExternalReferences, checkedText }),
      (error: AppError) => setValidation({ status: "failed", error, checkedText }),
    );
  }

  function cancel() {
    if (validation.status !== "running") return;
    void caddyCancelValidate(validation.runId).catch(() => undefined);
  }

  function saveRaw() {
    setSave({ status: "saving" });
    caddySaveRaw(text).then(
      () => setSave({ status: "saved" }),
      (error: AppError) => setSave({ status: "failed", error }),
    );
  }

  return (
    <RawEditorView
      hidden={hidden}
      blockReason={workdirReason}
      text={text}
      load={load}
      validation={validation}
      save={save}
      onTextChange={changeText}
      onValidate={() => runValidation(false)}
      onAllowExternalAndValidate={() => runValidation(true)}
      onCancel={cancel}
      onSave={saveRaw}
    />
  );
}
