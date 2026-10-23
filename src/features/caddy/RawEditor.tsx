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
import { localizeAppErrorMessage } from "../../i18n/errors";
import type { AppError } from "../../ipc/core";
import { useCaddyCopy, type CaddyCopy } from "./caddyCopy";
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
  const copy = useCaddyCopy();
  const { t } = copy;
  const loading = load.status === "loading";
  const blocked = blockReason !== undefined;
  const running = isRunning(validation);
  const saving = save.status === "saving";
  const saveBlocked = loading || load.status === "failed" || saving || blocked;
  const result = resultSummary(validation, copy);
  const stale = isResultStale(validation, text);
  const canAllow = result?.canAllowExternal === true && !allowedAlready(validation);

  return (
    <section
      hidden={hidden}
      aria-labelledby="raw-editor-heading"
      className="grid min-w-0 gap-ui-8"
    >
      <Panel className="grid gap-ui-8 p-ui-8">
        <h2 id="raw-editor-heading" className="text-sm font-semibold">
          {t("caddy.raw.heading")}
        </h2>
        <p className="m-0 text-aux text-muted-foreground">{t("caddy.raw.intro")}</p>
        <p role="note" className="m-0 text-aux text-warning">
          {t("caddy.raw.checkNote")}
        </p>
        {load.status === "failed" ? (
          <p role="alert" className="m-0 text-body text-danger">
            {t("caddy.raw.loadFailed", { error: localizeAppErrorMessage(load.error, copy.locale) })}
          </p>
        ) : null}
        {blockReason !== undefined ? (
          <p role="status" className="m-0 text-body text-muted-foreground">
            {t("caddy.raw.gateBlocked", { reason: blockReason })}
          </p>
        ) : null}
        {loading && !blocked ? (
          <p role="status" className="m-0 text-body text-muted-foreground">
            {t("caddy.raw.loading")}
          </p>
        ) : null}
        <TextAreaField
          label={t("caddy.raw.textLabel")}
          value={text}
          rows={18}
          spellCheck={false}
          disabled={loading || blocked}
          inputClassName="font-mono text-body"
          onValueChange={onTextChange}
        />
        <div className="flex flex-wrap items-center gap-ui-8">
          <Button
            variant="primary"
            disabled={loading || running || blocked}
            onClick={onValidate}
          >
            {t("caddy.raw.check")}
          </Button>
          {running ? (
            <Button variant="secondary" onClick={onCancel}>
              {t("caddy.raw.cancelCheck")}
            </Button>
          ) : null}
          {canAllow ? (
            <Button
              variant="secondary"
              disabled={running || blocked}
              onClick={onAllowExternalAndValidate}
            >
              {t("caddy.raw.allowAndCheck")}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={saveBlocked} onClick={onSave}>
            {saving ? t("caddy.save.saving") : t("caddy.raw.saveRaw")}
          </Button>
        </div>
        <SaveResult state={save} copy={copy} />
      </Panel>
      <ValidationResult
        validation={validation}
        summary={result}
        stale={stale}
      />
    </section>
  );
}

function resultSummary(
  validation: ValidationState,
  copy: CaddyCopy,
): ValidationSummary | undefined {
  if (validation.status === "done") return summarizeReport(validation.report, copy);
  if (validation.status === "failed") return summarizeFailure(validation.error, copy);
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
  const { t } = useCaddyCopy();
  if (validation.status === "running") {
    return (
      <Panel role="status" aria-live="polite" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body">{t("caddy.raw.checking")}</p>
      </Panel>
    );
  }
  if (!summary) return null;
  return (
    <Panel aria-labelledby="raw-validation-heading" className="grid gap-ui-8 p-ui-8">
      <h3 id="raw-validation-heading" className={`m-0 text-sm font-semibold ${TONE_CLASS[summary.tone]}`}>
        {summary.title}
      </h3>
      {stale ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          {t("caddy.raw.stale")}
        </p>
      ) : null}
      {summary.details.length > 0 ? (
        <ul className="m-0 grid gap-ui-4 pl-ui-8 text-body">
          {summary.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function SaveResult({ state, copy }: { state: SaveState; copy: CaddyCopy }) {
  if (state.status === "saved") {
    return (
      <p role="status" className="m-0 text-body text-success">
        {copy.t("caddy.raw.saved")}
      </p>
    );
  }
  if (state.status !== "failed") return null;
  return (
    <p role="alert" className="m-0 text-body text-danger">
      {copy.t("caddy.save.failed", { message: localizeAppErrorMessage(state.error, copy.locale) })}
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
