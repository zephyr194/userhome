import { useEffect, useState, type ReactNode } from "react";
import { dataHub } from "../../app/dataHub";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ActionRow,
  Button,
  CodeViewer,
  InfoTip,
  Modal,
  Panel,
  SectionTabs,
} from "../../components/ui";
import {
  SecretReplacementField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "../../components/ui/forms";
import { localizeError } from "../../i18n/errors";
import { useLocale } from "../../i18n/useLocale";
import {
  confirmAppConfigEdit,
  getAppConfigSchema,
  previewAppConfigEdit,
  readAppConfigForEdit,
  type AppConfigEditRead,
  type AppConfigFieldReadout,
  type AppConfigFieldSpec,
  type AppConfigListItem,
  type AppConfigPreviewInput,
  type AppConfigPreviewResult,
  type AppConfigSchema,
} from "../../ipc/appConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  appConfigCopy,
  definitionText,
  type AppConfigCopy,
} from "./appConfigModel";
import {
  checkFieldDraft,
  collectChanges,
  editModes,
  fieldStatus,
  initialTextFor,
  issuesByPath,
  rawIssues,
  type EditTab,
  type FieldDraft,
  type FieldDrafts,
} from "./appConfigEditModel";

export interface AppConfigEditorProps {
  item: AppConfigListItem;
  onExit: () => void;
  onSaved: (created: boolean) => void;
}

interface LoadedEdit {
  schema: AppConfigSchema;
  read: AppConfigEditRead;
}

type LoadState =
  | { status: "loading" }
  | { status: "failed"; error: AppError }
  | { status: "ready"; data: LoadedEdit };

type Phase =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "previewed"; result: AppConfigPreviewResult }
  | { status: "confirming"; result: AppConfigPreviewResult }
  | { status: "conflict" }
  | { status: "failed"; error: AppError };

const NO_CHANGES: AppError = {
  code: "INVALID_INPUT",
  message: "没有需要保存的修改。",
  retryable: false,
};

const FIX_FIRST: AppError = {
  code: "INVALID_INPUT",
  message: "请先修正标出的设置，再预览更改。",
  retryable: false,
};

const LOADING: LoadState = { status: "loading" };

export function AppConfigEditor({ item, onExit, onSaved }: AppConfigEditorProps) {
  const copy = appConfigCopy(useLocale());
  const { summary, probe } = item;
  // The list only includes existing entries; the created branch is kept for later.
  const created = probe.status === "notFound";
  const [loaded, setLoaded] = useState<{ key: number; state: LoadState } | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const load = loaded?.key === loadKey ? loaded.state : LOADING;
  const [mode, setMode] = useState<EditTab | null>(null);
  const [drafts, setDrafts] = useState<FieldDrafts>({});
  const [rawDraft, setRawDraft] = useState("");
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [pendingTab, setPendingTab] = useState<EditTab | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getAppConfigSchema(summary.id), readAppConfigForEdit(summary.id)]).then(
      ([schema, read]) => {
        if (!active) return;
        setLoaded({ key: loadKey, state: { status: "ready", data: { schema, read } } });
        setDrafts({});
        setRawDraft(read.rawText ?? "");
        setPhase({ status: "idle" });
      },
      (error: unknown) => {
        if (active) setLoaded({ key: loadKey, state: { status: "failed", error: decodeAppError(error) } });
      },
    );
    return () => {
      active = false;
    };
  }, [summary.id, loadKey]);

  const data = load.status === "ready" ? load.data : null;
  const modes = data ? editModes(data.schema) : null;
  const activeMode: EditTab | null =
    modes === null ? null : mode !== null && modes.tabs.includes(mode) ? mode : modes.initial;
  const rawBase = data?.read.rawText ?? "";
  const fieldsDirty = Object.keys(drafts).length > 0;
  const rawDirty = data !== null && rawDraft !== rawBase;
  const busy = phase.status === "previewing" || phase.status === "confirming";

  const isDirty = (tab: EditTab | null) =>
    tab === "fields" ? fieldsDirty : tab === "raw" ? rawDirty : false;

  const requestSwitch = (next: EditTab) => {
    if (next === activeMode) return;
    if (isDirty(activeMode)) {
      setPendingTab(next);
      return;
    }
    setMode(next);
  };

  const discardAndSwitch = (next: EditTab) => {
    if (activeMode === "fields") setDrafts({});
    if (activeMode === "raw") setRawDraft(rawBase);
    setPhase({ status: "idle" });
    setMode(next);
    setPendingTab(null);
  };

  const setDraft = (path: string, draft: FieldDraft | undefined) => {
    setDrafts((current) => {
      const next = { ...current };
      if (draft === undefined) delete next[path];
      else next[path] = draft;
      return next;
    });
    setPhase({ status: "idle" });
  };

  const setRaw = (text: string) => {
    setRawDraft(text);
    setPhase({ status: "idle" });
  };

  const requestExit = () => {
    if (fieldsDirty || rawDirty) setConfirmExit(true);
    else onExit();
  };

  const runPreview = () => {
    if (!data || activeMode === null) return;
    const expectedHash = data.read.hash;
    let input: AppConfigPreviewInput;
    if (activeMode === "fields") {
      const collected = collectChanges(data.schema.fields, drafts, copy);
      if (!collected.ok) {
        setPhase({ status: "failed", error: FIX_FIRST });
        return;
      }
      if (collected.changes.length === 0) {
        setPhase({ status: "failed", error: NO_CHANGES });
        return;
      }
      input = { id: summary.id, mode: "fields", changes: collected.changes, rawText: null, expectedHash };
    } else {
      if (rawDraft === rawBase) {
        setPhase({ status: "failed", error: NO_CHANGES });
        return;
      }
      input = { id: summary.id, mode: "raw", changes: [], rawText: rawDraft, expectedHash };
    }
    setPhase({ status: "previewing" });
    previewAppConfigEdit(input).then(
      (result) => setPhase({ status: "previewed", result }),
      (error: unknown) => setPhase({ status: "failed", error: decodeAppError(error) }),
    );
  };

  const runConfirm = (result: AppConfigPreviewResult) => {
    if (result.previewToken === null) return;
    setPhase({ status: "confirming", result });
    confirmAppConfigEdit(result.previewToken).then(
      () => {
        dataHub.invalidate("appConfig");
        onSaved(created);
      },
      (error: unknown) => {
        const decoded = decodeAppError(error);
        setPhase(decoded.code === "CONFLICT" ? { status: "conflict" } : { status: "failed", error: decoded });
      },
    );
  };

  const serverMessages =
    phase.status === "previewed" && !phase.result.ok ? phase.result.errors : [];
  const serverByPath = issuesByPath(serverMessages);
  const serverRaw = rawIssues(serverMessages);
  const knownPaths = new Set(data?.schema.fields.map((field) => field.path) ?? []);
  const unplaced = serverMessages.filter(
    (issue) =>
      issue.line === undefined && (issue.path === undefined || !knownPaths.has(issue.path)),
  );

  return (
    <section aria-label={copy.t("appConfig.edit.region")} className="grid min-w-0 content-start gap-ui-12">
      <div className="flex flex-wrap items-center justify-between gap-ui-8">
        <p className="m-0 min-w-0 break-all text-aux text-muted-foreground">
          {copy.t("appConfig.edit.editing", { path: summary.displayPath })}
        </p>
        <Button size="sm" variant="default" disabled={busy} onClick={requestExit}>
          {copy.t("appConfig.edit.backToView")}
        </Button>
      </div>

      {load.status === "loading" ? (
        <p role="status" className="m-0 text-body text-muted-foreground">
          {copy.t("appConfig.loading")}
        </p>
      ) : null}

      {load.status === "failed" ? (
        <Panel role="alert" className="grid gap-ui-8 p-ui-8">
          <p className="m-0 text-body font-semibold text-danger">
            {copy.t("appConfig.edit.loadFailed")}
          </p>
          <p className="m-0 text-body">{localizeError(load.error, copy.locale)}</p>
          <div>
            <Button size="sm" variant="danger" onClick={() => setLoadKey((key) => key + 1)}>
              {copy.t("common.retry")}
            </Button>
          </div>
        </Panel>
      ) : null}

      {data && probe.status === "notFound" ? (
        <p className="m-0 text-aux text-muted-foreground">{copy.t("appConfig.edit.willCreate")}</p>
      ) : null}

      {data && modes && modes.tabs.length === 0 ? (
        <p className="m-0 text-body">{copy.t("appConfig.edit.unsupported")}</p>
      ) : null}

      {data && modes && modes.tabs.length === 2 ? (
        <SectionTabs
          label={copy.t("appConfig.edit.modeLabel")}
          sections={[
            { id: "fields", label: copy.t("appConfig.edit.modeFields") },
            { id: "raw", label: copy.t("appConfig.edit.modeRaw") },
          ]}
          selected={activeMode ?? "fields"}
          onSelect={(section) => requestSwitch(section as EditTab)}
        />
      ) : null}

      {data && activeMode === "fields" ? (
        <FieldsForm
          fields={data.schema.fields}
          readouts={data.read.fields}
          drafts={drafts}
          serverByPath={serverByPath}
          disabled={busy}
          onChange={setDraft}
        />
      ) : null}

      {data && activeMode === "raw" ? (
        data.read.rawBlockedReason !== null ? (
          <p role="status" className="m-0 text-body">
            {data.read.rawBlockedReason}
          </p>
        ) : (
          <TextAreaField
            label={copy.t("appConfig.edit.rawLabel")}
            value={rawDraft}
            spellCheck={false}
            rows={16}
            inputClassName="font-mono text-aux"
            disabled={busy}
            error={
              serverRaw.length > 0 ? (
                <ul className="m-0 grid list-none gap-ui-4 p-0">
                  {serverRaw.map((issue) => (
                    <li key={`${issue.line}-${issue.message}`}>
                      {copy.t("appConfig.line", { line: issue.line, message: issue.message })}
                    </li>
                  ))}
                </ul>
              ) : undefined
            }
            onValueChange={setRaw}
          />
        )
      ) : null}

      {unplaced.length > 0 ? (
        <ul className="m-0 grid list-none gap-ui-4 p-0 text-aux text-danger" role="alert">
          {unplaced.map((issue) => (
            <li key={issue.message}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      <PhaseNotice phase={phase} onReload={() => setLoadKey((key) => key + 1)} copy={copy} />

      {data && activeMode !== null && !(activeMode === "raw" && data.read.rawBlockedReason !== null) ? (
        <ActionRow>
          <Button
            variant="primary"
            disabled={busy}
            onClick={runPreview}
          >
            {phase.status === "previewing"
              ? copy.t("appConfig.edit.previewing")
              : copy.t("common.previewChanges")}
          </Button>
        </ActionRow>
      ) : null}

      {phase.status === "previewed" && phase.result.ok ? (
        <PreviewModal
          result={phase.result}
          displayPath={summary.displayPath}
          created={created}
          busy={false}
          onCancel={() => setPhase({ status: "idle" })}
          onConfirm={() => runConfirm(phase.result)}
        />
      ) : null}
      {phase.status === "confirming" ? (
        <PreviewModal
          result={phase.result}
          displayPath={summary.displayPath}
          created={created}
          busy
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      ) : null}

      {pendingTab !== null ? (
        <ConfirmDialog
          bodyClassName="grid gap-ui-12"
          titleId="app-config-tab-switch"
          onCancel={() => setPendingTab(null)}
        >
          <h3 id="app-config-tab-switch" className="m-0 text-group font-semibold">
            {copy.t("appConfig.edit.discardSwitchTitle")}
          </h3>
          <ActionRow align="end">
            <Button variant="default" onClick={() => setPendingTab(null)}>
              {copy.t("appConfig.edit.stay")}
            </Button>
            <Button variant="danger" onClick={() => discardAndSwitch(pendingTab)}>
              {copy.t("appConfig.edit.discardAndSwitch")}
            </Button>
          </ActionRow>
        </ConfirmDialog>
      ) : null}

      {confirmExit ? (
        <ConfirmDialog
          bodyClassName="grid gap-ui-12"
          titleId="app-config-exit"
          onCancel={() => setConfirmExit(false)}
        >
          <h3 id="app-config-exit" className="m-0 text-group font-semibold">
            {copy.t("appConfig.edit.discardExitTitle")}
          </h3>
          <ActionRow align="end">
            <Button variant="default" onClick={() => setConfirmExit(false)}>
              {copy.t("appConfig.edit.keepEditing")}
            </Button>
            <Button variant="danger" onClick={onExit}>
              {copy.t("appConfig.edit.discardAndExit")}
            </Button>
          </ActionRow>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function PhaseNotice({
  phase,
  onReload,
  copy,
}: {
  phase: Phase;
  onReload: () => void;
  copy: AppConfigCopy;
}) {
  switch (phase.status) {
    case "conflict":
      return (
        <Panel role="alert" className="grid gap-ui-8 p-ui-8">
          <p className="m-0 text-body font-semibold text-danger">{copy.t("appConfig.edit.conflict")}</p>
          <div>
            <Button size="sm" variant="danger" onClick={onReload}>
              {copy.t("appConfig.edit.reread")}
            </Button>
          </div>
        </Panel>
      );
    case "failed":
      return (
        <p role="alert" className="m-0 text-aux text-danger">
          {localizeError(phase.error, copy.locale)}
        </p>
      );
    case "idle":
    case "previewing":
    case "previewed":
    case "confirming":
      return null;
  }
}

function PreviewModal({
  result,
  displayPath,
  created,
  busy,
  onCancel,
  onConfirm,
}: {
  result: AppConfigPreviewResult;
  displayPath: string;
  created: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = appConfigCopy(useLocale());
  const empty = result.diff.trim().length === 0;
  return (
    <Modal
      busy={busy}
      footer={
        <>
          <Button variant="default" disabled={busy} onClick={onCancel}>
            {copy.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || empty || result.previewToken === null}
            onClick={onConfirm}
          >
            {busy ? copy.t("appConfig.edit.writing") : copy.t("appConfig.edit.confirmWrite")}
          </Button>
        </>
      }
      open
      title={copy.t("common.previewChanges")}
      onClose={onCancel}
    >
      <div className="grid min-w-0 gap-ui-8">
        <p className="m-0 break-all text-aux">{copy.t("appConfig.edit.saveTo", { path: displayPath })}</p>
        <p className="m-0 text-aux">
          {created ? copy.t("appConfig.edit.createdNoBackup") : copy.t("appConfig.edit.backupFirst")}
        </p>
        {result.warnings.map((warning) => (
          <p key={warning} className="m-0 text-aux text-warning">
            {warning}
          </p>
        ))}
        {empty ? (
          <p className="m-0 text-aux text-muted-foreground">{copy.t("appConfig.edit.noActualChange")}</p>
        ) : (
          <>
            <p className="m-0 text-aux text-muted-foreground">{copy.t("appConfig.edit.diffHelp")}</p>
            <CodeViewer
              allowWindow={false}
              label={copy.t("appConfig.edit.diffLabel")}
              language="plain"
              text={result.diff}
              title={copy.t("appConfig.edit.diffTitle")}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

function FieldsForm({
  fields,
  readouts,
  drafts,
  serverByPath,
  disabled,
  onChange,
}: {
  fields: readonly AppConfigFieldSpec[];
  readouts: readonly AppConfigFieldReadout[];
  drafts: FieldDrafts;
  serverByPath: Record<string, string>;
  disabled: boolean;
  onChange: (path: string, draft: FieldDraft | undefined) => void;
}) {
  const copy = appConfigCopy(useLocale());
  return (
    <ul aria-label={copy.t("appConfig.edit.fieldsLabel")} className="m-0 grid list-none gap-ui-12 p-0">
      {fields.map((spec) => {
        const readout = readouts.find((candidate) => candidate.path === spec.path);
        const draft = drafts[spec.path];
        const clientError = draft ? clientMessage(spec, draft, copy) : undefined;
        return (
          <FieldRow
            key={spec.path}
            spec={spec}
            readout={readout}
            draft={draft}
            disabled={disabled}
            error={clientError ?? serverByPath[spec.path]}
            onChange={(next) => onChange(spec.path, next)}
          />
        );
      })}
    </ul>
  );
}

function clientMessage(
  spec: AppConfigFieldSpec,
  draft: FieldDraft,
  copy: AppConfigCopy,
): string | undefined {
  const checked = checkFieldDraft(spec, draft, copy);
  return checked.ok ? undefined : checked.message;
}

function rangeHint(spec: AppConfigFieldSpec, copy: AppConfigCopy): string | null {
  if (spec.kind !== "integer" && spec.kind !== "number") return null;
  if (spec.min !== null && spec.max !== null) {
    return copy.t("appConfig.range.between", { min: spec.min, max: spec.max });
  }
  if (spec.min !== null) return copy.t("appConfig.range.atLeast", { min: spec.min });
  if (spec.max !== null) return copy.t("appConfig.range.atMost", { max: spec.max });
  return null;
}

function FieldRow({
  spec,
  readout,
  draft,
  disabled,
  error,
  onChange,
}: {
  spec: AppConfigFieldSpec;
  readout: AppConfigFieldReadout | undefined;
  draft: FieldDraft | undefined;
  disabled: boolean;
  error: string | undefined;
  onChange: (next: FieldDraft | undefined) => void;
}) {
  const copy = appConfigCopy(useLocale());
  const label = definitionText(copy, `field.${spec.path}`, spec.label);
  const description = definitionText(copy, `field.${spec.path}.description`, spec.description);
  const status = fieldStatus(spec, readout, draft, copy);
  const tip: ReactNode = <InfoTip title={label} description={description} />;
  const text = draft?.kind === "text" ? draft.text : initialTextFor(spec, readout);
  const removable = Boolean(readout?.present) && draft?.kind !== "remove";
  const hint = rangeHint(spec, copy);

  return (
    <li className="grid min-w-0 gap-ui-4 border-t border-line pt-ui-12">
      {spec.kind === "bool" ? (
        <SwitchField
          label={label}
          tip={tip}
          checked={draft?.kind === "bool" ? draft.value : readout?.value === true}
          disabled={disabled}
          error={error}
          onCheckedChange={(value) => onChange({ kind: "bool", value })}
        />
      ) : null}
      {spec.kind === "enum" ? (
        <SelectField<string>
          label={label}
          tip={tip}
          value={text}
          disabled={disabled}
          error={error}
          options={[
            { value: "", label: copy.t("appConfig.edit.selectPlaceholder") },
            ...spec.enumValues.map((value) => ({ value, label: value })),
          ]}
          onValueChange={(value) => onChange({ kind: "text", text: value })}
        />
      ) : null}
      {spec.kind === "string" && spec.sensitive ? (
        <SecretReplacementField
          label={label}
          tip={tip}
          value={text}
          placeholder={
            readout?.present
              ? copy.t("appConfig.field.secretPlaceholder")
              : copy.t("appConfig.field.status.unset")
          }
          disabled={disabled}
          error={error}
          onValueChange={(value) => onChange({ kind: "text", text: value })}
        />
      ) : null}
      {spec.kind === "string" && !spec.sensitive ? (
        <TextField
          label={label}
          tip={tip}
          value={text}
          maxLength={256}
          disabled={disabled}
          error={error}
          onValueChange={(value) => onChange({ kind: "text", text: value })}
        />
      ) : null}
      {spec.kind === "integer" || spec.kind === "number" ? (
        <TextField
          label={label}
          tip={tip}
          value={text}
          inputMode={spec.kind === "integer" ? "numeric" : "decimal"}
          disabled={disabled}
          error={error}
          onValueChange={(value) => onChange({ kind: "text", text: value })}
        />
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <p className="m-0 flex flex-wrap gap-x-ui-12 text-aux text-muted-foreground">
          <span className={status.changed ? "text-foreground" : undefined}>{status.label}</span>
          {hint ? <span>{hint}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-ui-4">
          {draft ? (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>
              {copy.t("appConfig.edit.undo")}
            </Button>
          ) : null}
          {removable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ kind: "remove" })}
            >
              {spec.default !== null
                ? copy.t("appConfig.edit.restoreDefault")
                : copy.t("appConfig.edit.remove")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
