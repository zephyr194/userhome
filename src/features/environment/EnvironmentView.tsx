import { AsyncState } from "../../components/AsyncState";
import {
  Button,
  SelectField,
  StatusBadge,
  SwitchField,
  TextAreaField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { formatByteSize } from "../../i18n/format";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import type { EnvFileOutcome, ScanOutcome } from "../../ipc/environment";
import { DotenvEditor, type DotenvEditorProps } from "./DotenvEditor";
import type { DirectoryGrant, DirectoryState, DotenvWorkspaceState } from "./dotenvDirectoryModel";
import { directoryVariableSources } from "./dotenvDirectoryModel";
import { checkSettings, failureText, partialReasonText, sameSettings, skipReasonText } from "./environmentModel";
import { VariableChainList } from "./VariableChainTable";
import { dotenvChainRows, type VariableChainRow } from "./variableChainModel";

export interface EnvironmentActions {
  addGrant: () => void;
  addVariable: (path: string) => void;
  editRow: (path: string, line: number) => void;
  loadValue: (path: string, key: string, line: number) => Promise<string>;
  newFile: () => void;
  rescan: () => void;
  revokeGrant: (grantId: string) => void;
  reloadGrants: () => void;
  selectFile: (path: string | undefined) => void;
  setPatterns: (text: string) => void;
  setRecursive: (recursive: boolean) => void;
}

export interface EnvironmentViewProps {
  grants: DotenvWorkspaceState["grants"];
  /** The directory tab that is shown; undefined while there are none. */
  selectedGrant?: DirectoryGrant;
  directory: DirectoryState;
  patternsText: string;
  recursive: boolean;
  grantNotice?: { tone: "info" | "error"; text: string };
  addingGrant: boolean;
  choosingNewFile?: boolean;
  /** The key editor; while it is open the variable list is replaced by it. */
  editor?: DotenvEditorProps;
  actions: EnvironmentActions;
}

function editorOpen(props: Pick<EnvironmentViewProps, "editor">): boolean {
  return props.editor !== undefined && props.editor.state.phase !== "closed";
}

/**
 * The dotenv level of one directory tab: the variables of the files in the
 * directory on top, with a search field and a file filter; scan settings and
 * the file list sit in a collapsed section underneath.
 */
export function EnvironmentView(props: EnvironmentViewProps) {
  const t = useT();
  if (editorOpen(props) && props.editor) {
    return (
      <section aria-labelledby="environment-editor-heading" className="flex min-w-0 flex-col">
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8 px-ui-12 pt-ui-12 pb-ui-8">
          <div className="min-w-0">
            <h2 className="text-group font-semibold" id="environment-editor-heading">
              {t("env.dotenv.editor.heading")}
            </h2>
            <p className="mt-ui-4 break-all text-xs text-muted-foreground">
              {props.editor.state.target?.kind === "new"
                ? props.editor.state.target.displayPath
                : (props.editor.state.target?.path ?? t("env.dotenv.noFile"))}
            </p>
          </div>
        </header>
        <div className="px-ui-12 py-ui-8">
          <DotenvEditor {...props.editor} />
        </div>
      </section>
    );
  }
  return <DirectoryContent {...props} />;
}

function DirectoryContent(props: EnvironmentViewProps) {
  const t = useT();
  const locale = useLocale();
  const { grants, selectedGrant, actions } = props;
  if (grants.status === "loading") {
    return <AsyncState kind="loading">{t("env.dotenv.grants.loading")}</AsyncState>;
  }
  if (grants.status === "error") {
    return (
      <AsyncState kind="error">
        <span className="break-words [overflow-wrap:anywhere]">
          {localizeError(grants.error, locale)}
        </span>{" "}
        <Button onClick={actions.reloadGrants} size="sm">
          {t("env.dotenv.retry")}
        </Button>
      </AsyncState>
    );
  }
  if (selectedGrant === undefined) {
    return (
      <div className="flex flex-col items-start gap-ui-8 px-ui-12 py-ui-12">
        <AsyncState kind="empty">{t("env.dotenv.noGrants")}</AsyncState>
        <Button disabled={props.addingGrant} onClick={actions.addGrant} size="sm" variant="primary">
          {props.addingGrant ? t("env.dotenv.grant.waiting") : t("env.dotenv.grant.add")}
        </Button>
        <GrantNotice notice={props.grantNotice} />
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-ui-12 px-ui-12 py-ui-8">
      <GrantNotice notice={props.grantNotice} />
      <DirectoryHeader
        actions={actions}
        choosingNewFile={props.choosingNewFile}
        directory={props.directory}
        editable={props.editor !== undefined}
        grant={selectedGrant}
      />
      <DirectoryStatus actions={actions} directory={props.directory} />
      <VariableListBody
        actions={actions}
        directory={props.directory}
        editable={props.editor !== undefined}
        grantId={selectedGrant.id}
      />
      <SettingsDetails {...props} />
    </div>
  );
}

function GrantNotice({ notice }: { notice?: EnvironmentViewProps["grantNotice"] }) {
  if (!notice) return null;
  return (
    <p
      className={classNames(
        "text-xs leading-relaxed",
        notice.tone === "error" ? "text-danger" : "text-muted-foreground",
      )}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

/** Which file “设置变量” adds to: the filtered file, or the only file of the directory. */
function targetFile(directory: DirectoryState): string | undefined {
  if (directory.scan.status !== "ready") return undefined;
  if (directory.fileFilter !== undefined) return directory.fileFilter;
  const files = directory.scan.outcome.files;
  return files.length === 1 ? files[0]?.relativePath : undefined;
}

function DirectoryHeader({
  actions,
  choosingNewFile,
  directory,
  editable,
  grant,
}: {
  actions: EnvironmentActions;
  choosingNewFile?: boolean;
  directory: DirectoryState;
  editable: boolean;
  grant: DirectoryGrant;
}) {
  const t = useT();
  const target = targetFile(directory);
  const file = target === undefined ? undefined : directory.files[target];
  const canAdd = file?.status === "loaded" && file.outcome.status === "READY";
  const blockedReason = target === undefined
    ? t("env.dotenv.addNeedsFile")
    : canAdd
      ? undefined
      : t("env.dotenv.addNeedsRead");
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
      <div className="min-w-0">
        <p className="break-all font-mono text-aux text-foreground" title={grant.displayPath}>
          {grant.displayPath}
        </p>
        {editable && blockedReason ? (
          <p className="mt-ui-4 text-xs text-muted-foreground">{blockedReason}</p>
        ) : null}
      </div>
      {editable ? (
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          <Button
            disabled={!canAdd || target === undefined}
            onClick={() => target !== undefined && actions.addVariable(target)}
            size="sm"
            variant="primary"
          >
            {t("env.dotenv.addVariable")}
          </Button>
          <Button
            disabled={choosingNewFile === true}
            onClick={actions.newFile}
            size="sm"
          >
            {choosingNewFile ? t("env.dotenv.newFile.waiting") : t("env.dotenv.newFile")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Scan and read status of the directory; empty and error states say what to do next. */
function DirectoryStatus({ actions, directory }: { actions: EnvironmentActions; directory: DirectoryState }) {
  const t = useT();
  const locale = useLocale();
  const { scan } = directory;
  if (scan.status === "idle" || scan.status === "loading") {
    return <AsyncState kind="loading">{t("env.dotenv.scanning")}</AsyncState>;
  }
  if (scan.status === "error") {
    return (
      <AsyncState kind="error">
        <span className="break-words [overflow-wrap:anywhere]">
          {localizeError(scan.error, locale)}
        </span>
        {scan.error.retryable ? (
          <>
            {" "}
            <Button onClick={actions.rescan} size="sm">
              {t("env.dotenv.retry")}
            </Button>
          </>
        ) : null}
      </AsyncState>
    );
  }
  const { outcome } = scan;
  const sources = directoryVariableSources(directory);
  return (
    <div className="grid gap-ui-8">
      {outcome.partialReasons.length > 0 ? (
        <AsyncState kind="partial">
          {t("env.dotenv.partial")}
          <ul className="mt-ui-4 list-disc pl-ui-16">
            {outcome.partialReasons.map((reason) => (
              <li key={reason}>{partialReasonText(reason, outcome.limits, t)}</li>
            ))}
          </ul>
        </AsyncState>
      ) : null}
      {sources.unreadable.length > 0 ? (
        <AsyncState kind="partial">
          {t("env.dotenv.unreadable", { names: sources.unreadable.join(t("env.dotenv.listSeparator")) })}
        </AsyncState>
      ) : null}
      {sources.pending > 0 ? (
        <AsyncState kind="loading">{t("env.dotenv.reading", { count: sources.pending })}</AsyncState>
      ) : null}
    </div>
  );
}

function VariableListBody({
  actions,
  directory,
  editable,
  grantId,
}: {
  actions: EnvironmentActions;
  directory: DirectoryState;
  editable: boolean;
  grantId: string;
}) {
  const t = useT();
  const sources = directoryVariableSources(directory);
  const rows = dotenvChainRows(sources.readable, t);
  const merged = rows.some((row) => row.definedIn !== undefined);
  const scanned = directory.scan.status === "ready" ? directory.scan.outcome.files : [];
  const fileOptions = [
    { value: "ALL", label: t("env.dotenv.allFiles") },
    ...scanned.map((file) => ({ value: file.relativePath, label: file.relativePath })),
  ];

  const edit = (row: VariableChainRow) => {
    if (row.definedIn !== undefined) return;
    const line = row.final.source.line;
    if (line === undefined) return;
    actions.editRow(row.final.source.file, line);
  };
  const reveal = (row: VariableChainRow): Promise<string> => {
    const line = row.final.source.line;
    if (line === undefined) return Promise.reject(new Error(t("env.dotenv.changed")));
    return actions.loadValue(row.final.source.file, row.name, line);
  };

  const filter = (
    <SelectField<string>
      className="min-w-0"
      inputClassName="h-control-md"
      label={t("env.dotenv.fileFilter")}
      onValueChange={(value) => actions.selectFile(value === "ALL" ? undefined : value)}
      options={fileOptions}
      value={directory.fileFilter ?? "ALL"}
    />
  );

  return (
    <div className="grid min-w-0 gap-ui-8">
      {merged ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t("env.dotenv.noPriority")}</p>
      ) : null}
      <VariableChainList
        emptyState={
          sources.pending > 0 ? null : <AsyncState kind="empty">{t("env.dotenv.noVariables")}</AsyncState>
        }
        filter={filter}
        label={t("env.dotenv.table")}
        onEdit={editable ? edit : undefined}
        onRevealFinal={reveal}
        rows={rows}
        searchKey={`dotenv:${grantId}`}
      />
    </div>
  );
}

function SettingsDetails(props: EnvironmentViewProps) {
  const t = useT();
  const { actions, directory, patternsText, recursive, selectedGrant } = props;
  const check = checkSettings(patternsText, recursive, t);
  const scanned = directory.scan.status === "ready" ? directory.scan.settings : undefined;
  const changed = scanned !== undefined && check.ok && !sameSettings(scanned, check.settings);
  const scanning = directory.scan.status === "loading";
  const scanBlocked = scanning ? undefined : !check.ok ? t("env.dotenv.scan.patternFirst") : undefined;
  return (
    <details className="group min-w-0 border-t border-line pt-ui-8">
      <summary className="cursor-pointer text-aux font-semibold text-foreground">
        {t("env.dotenv.details")}
      </summary>
      <div className="grid gap-ui-16 pt-ui-12">
        <section aria-labelledby="environment-settings-heading" className="grid gap-ui-8">
          <h3 className="text-aux font-semibold" id="environment-settings-heading">
            {t("env.dotenv.settings.heading")}
          </h3>
          <TextAreaField
            description={t("env.dotenv.settings.patternDescription")}
            error={check.ok ? undefined : check.message}
            label={t("env.dotenv.settings.pattern")}
            maxLength={2048}
            onValueChange={actions.setPatterns}
            rows={3}
            spellCheck={false}
            value={patternsText}
          />
          <SwitchField
            checked={recursive}
            description={t("env.dotenv.settings.recursiveDescription")}
            label={t("env.dotenv.settings.recursive")}
            onCheckedChange={actions.setRecursive}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
            <Button
              aria-describedby={scanBlocked ? "environment-scan-reason" : undefined}
              disabled={!check.ok || scanning || selectedGrant === undefined}
              onClick={actions.rescan}
              variant="primary"
            >
              {scanning ? t("env.dotenv.scanning.button") : t("env.dotenv.scan")}
            </Button>
            {scanBlocked ? (
              <span className="text-xs text-muted-foreground" id="environment-scan-reason">
                {scanBlocked}
              </span>
            ) : null}
            {changed ? (
              <span className="text-xs text-warning" role="status">
                {t("env.dotenv.settings.changed")}
              </span>
            ) : null}
          </div>
        </section>
        <ScanFileList directory={directory} />
        {selectedGrant !== undefined ? (
          <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
            <Button
              aria-label={t("env.dotenv.grant.revokeLabel", { path: selectedGrant.displayPath })}
              onClick={() => actions.revokeGrant(selectedGrant.id)}
              size="sm"
              variant="ghost"
            >
              {t("env.dotenv.grant.revoke")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("env.dotenv.grant.note")}</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ScanFileList({ directory }: { directory: DirectoryState }) {
  const t = useT();
  const locale = useLocale();
  if (directory.scan.status !== "ready") return null;
  const outcome: ScanOutcome = directory.scan.outcome;
  if (outcome.files.length === 0) {
    return <AsyncState kind="empty">{t("env.dotenv.noFiles")}</AsyncState>;
  }
  return (
    <section aria-labelledby="environment-files-heading" className="grid gap-ui-8">
      <h3 className="text-aux font-semibold" id="environment-files-heading">
        {t("env.dotenv.files.heading", { count: outcome.files.length })}
      </h3>
      <ul aria-label={t("env.dotenv.files.list")} className="grid gap-ui-4">
        {outcome.files.map((file) => {
          const state = directory.files[file.relativePath];
          return (
            <li className="flex min-w-0 flex-wrap items-center gap-ui-8" key={file.relativePath}>
              <span className="min-w-0 break-all font-mono text-aux">{file.relativePath}</span>
              {file.kind === "TEMPLATE" ? (
                <StatusBadge tone="warning">{t("env.dotenv.files.template")}</StatusBadge>
              ) : null}
              {file.symlink ? <StatusBadge>{t("env.dotenv.files.symlink")}</StatusBadge> : null}
              {file.oversized ? <StatusBadge tone="danger">{t("env.dotenv.files.oversized")}</StatusBadge> : null}
              <span className="text-meta text-muted-foreground">
                {formatByteSize(file.sizeBytes, locale)}
              </span>
              <span className="text-meta text-muted-foreground">
                {fileStateText(state, t)}
              </span>
            </li>
          );
        })}
      </ul>
      {outcome.skippedTotal > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("env.dotenv.skipped", { count: outcome.skippedTotal })}</summary>
          <p className="mt-ui-4 leading-relaxed">
            {t("env.dotenv.exclusions", {
              list: outcome.exclusions.join(t("env.dotenv.listSeparator")),
              count: outcome.excludedDirectories,
            })}
          </p>
          <ul className="mt-ui-4 list-disc pl-ui-16">
            {outcome.skipped.map((entry, index) => (
              <li className="break-all" key={`${entry.relativePath ?? ""}:${index}`}>
                {entry.relativePath ?? t("env.dotenv.unnamed")}：{skipReasonText(entry.reason, t)}
              </li>
            ))}
          </ul>
          {outcome.skippedTotal > outcome.skipped.length ? (
            <p className="mt-ui-4">
              {t("env.dotenv.moreSkipped", { count: outcome.skippedTotal - outcome.skipped.length })}
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function fileStateText(
  state: DirectoryState["files"][string] | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (state === undefined || state.status === "loading") return t("env.dotenv.files.reading");
  if (state.status === "error") return failureText("IO", t);
  return fileOutcomeText(state.outcome, t);
}

function fileOutcomeText(outcome: EnvFileOutcome, t: ReturnType<typeof useT>): string {
  if (outcome.status === "UNAVAILABLE") return failureText(outcome.reason, t);
  return t("env.dotenv.files.lines", { count: outcome.file.lineCount });
}
