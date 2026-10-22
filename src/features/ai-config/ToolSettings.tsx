import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import {
  getClaudeEditCatalog,
  getClaudeSnapshot,
  readClaudeSettings,
  type ClaudeEditCatalog,
  type ClaudeReadView,
  type ClaudeSnapshotSummary,
} from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import { selectDirectoryGrant, selectFileGrant } from "../../ipc/grants";
import {
  entryBadges,
  isPartialView,
  layerStateText,
  layerTitle,
  overriddenText,
  resolveSelection,
  valueText,
  winnerText,
  type ProjectGrant,
} from "./claudeSettingsModel";
import { EditPanel, type SettingsFileSelection } from "./SettingEditor";

export type ClaudeReadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: ClaudeReadView }
  | { readonly status: "failed"; readonly error: AppError };

export type ProjectSelection =
  | { readonly status: "idle" }
  | { readonly status: "selecting" }
  | { readonly status: "failed"; readonly error: AppError };

export interface EditingState {
  readonly catalog: ClaudeEditCatalog | null;
  readonly settingsFile: SettingsFileSelection | null;
  readonly choosing: boolean;
  readonly chooseError: AppError | null;
  readonly onChooseSettingsFile: () => void;
  readonly onSaved: () => void;
}

export interface ClaudeSettingsViewProps {
  readonly state: ClaudeReadState;
  readonly snapshot: ClaudeSnapshotSummary | null;
  readonly projectGrant: ProjectGrant | null;
  readonly selection: ProjectSelection;
  readonly onChooseProject: () => void;
  readonly onClearProject: () => void;
  readonly onRetry: () => void;
  readonly editing?: EditingState;
}

export function ClaudeSettingsView({
  state,
  snapshot,
  projectGrant,
  selection,
  onChooseProject,
  onClearProject,
  onRetry,
  editing,
}: ClaudeSettingsViewProps) {
  const busy = state.status === "loading" || selection.status === "selecting";
  return (
    <section className="grid min-w-0 gap-ui-md" aria-label="Claude Code 设置">
      <header className="grid gap-ui-xs">
        <h2 className="m-0 text-body font-semibold">Claude Code 设置</h2>
        <p className="m-0 text-aux text-muted-foreground">
          仅展示官方设置文件的内容与覆盖关系，不运行 hooks、MCP 或项目命令，不修改信任设置。
          编辑入口存在，但在版本区间核实前整体禁用；编辑项由后端 editable/reason 逐项决定。
        </p>
        {snapshot ? (
          <p className="m-0 text-aux text-muted-foreground">
            来源：{snapshot.sourceUrl}（抓取日期 {snapshot.retrievedOn}，适用版本
            {snapshot.documentedVersion === "unknown" ? "未知" : snapshot.documentedVersion}）；
            已登记 {snapshot.settingCount} 个设置键、{snapshot.resourceCount} 个来源，
            可编辑 {snapshot.editable} 项。
          </p>
        ) : (
          <p className="m-0 text-aux text-muted-foreground">定义摘要不可用。</p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-ui-sm">
        <span className="text-aux text-muted-foreground">
          项目：{projectGrant ? projectGrant.displayPath : "未选择（只读取用户级与托管层）"}
        </span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onChooseProject}>
          {projectGrant ? "更换项目" : "选择项目"}
        </Button>
        {projectGrant ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClearProject}>
            取消项目
          </Button>
        ) : null}
        {selection.status === "failed" ? (
          <span role="alert" className="text-aux text-danger">
            {selection.error.message}
          </span>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="m-0 text-aux text-muted-foreground" role="status">
          正在读取 Claude Code 设置…
        </p>
      ) : null}

      {state.status === "failed" ? (
        <div className="grid justify-items-start gap-ui-xs" role="alert">
          <p className="m-0 text-aux text-danger">{state.error.message}</p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onRetry}>
            重新读取
          </Button>
        </div>
      ) : null}

      {state.status === "ready" ? <ReadResult view={state.view} /> : null}
      {editing ? (
        <EditPanel
          {...editing}
          view={state.status === "ready" ? state.view : null}
        />
      ) : null}
    </section>
  );
}

function ReadResult({ view }: { readonly view: ClaudeReadView }) {
  return (
    <div className="grid min-w-0 gap-ui-md">
      {isPartialView(view) ? (
        <p className="m-0 text-aux text-danger" role="status">
          部分来源不可读或存在解析问题，结果可能不完整。
        </p>
      ) : null}

      <section aria-label="来源层级" className="grid gap-ui-xs">
        <h3 className="m-0 text-aux font-semibold">来源层级（按覆盖顺序，自上而下优先）</h3>
        <ol className="m-0 grid gap-ui-xs pl-ui-lg text-aux">
          {view.layers.map((layer) => (
            <li key={layer.id}>
              {layer.precedence !== null ? `${layer.precedence}. ` : ""}
              {layerTitle(layer.id)}：{layerStateText(layer.state)}
              <span className="text-muted-foreground">（{layer.location}）</span>
            </li>
          ))}
        </ol>
      </section>

      {view.warnings.length > 0 ? (
        <ul aria-label="解析警告" className="m-0 grid gap-ui-xs pl-ui-lg text-aux text-danger">
          {view.warnings.map((warning, index) => (
            <li key={`${warning.layerId}-${warning.key}-${index}`}>
              {layerTitle(warning.layerId)} · {warning.key}：{warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {view.entries.length === 0 ? (
        <p className="m-0 text-aux text-muted-foreground">未发现已设置的键。</p>
      ) : (
        <ul aria-label="设置键" className="m-0 grid list-none gap-ui-sm p-0">
          {view.entries.map((entry) => (
            <li key={entry.key} className="grid gap-ui-xs border-t border-border pt-ui-sm">
              <div className="flex flex-wrap items-baseline gap-ui-sm">
                <code className="text-aux font-semibold">{entry.key}</code>
                {entryBadges(entry).map((badge) => (
                  <span key={badge} className="text-aux text-muted-foreground">
                    [{badge}]
                  </span>
                ))}
              </div>
              <code className="break-all text-aux">{valueText(entry.value)}</code>
              <div className="text-aux text-muted-foreground">
                来源：{winnerText(entry)} · {overriddenText(entry)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ToolSettings() {
  const [state, setState] = useState<ClaudeReadState>({ status: "loading" });
  const [snapshot, setSnapshot] = useState<ClaudeSnapshotSummary | null>(null);
  const [projectGrant, setProjectGrant] = useState<ProjectGrant | null>(null);
  const [selection, setSelection] = useState<ProjectSelection>({ status: "idle" });
  const [catalog, setCatalog] = useState<ClaudeEditCatalog | null>(null);
  const [settingsFile, setSettingsFile] = useState<SettingsFileSelection | null>(null);
  const [choosingFile, setChoosingFile] = useState(false);
  const [chooseFileError, setChooseFileError] = useState<AppError | null>(null);
  const requestCounter = useRef(0);

  const fetchView = useCallback((grant: ProjectGrant | null) => {
    const requestId = ++requestCounter.current;
    return readClaudeSettings(grant ? grant.id : null).then(
      (view) => {
        if (requestId === requestCounter.current) setState({ status: "ready", view });
      },
      (error: unknown) => {
        if (requestId === requestCounter.current) {
          setState({ status: "failed", error: decodeAppError(error) });
        }
      },
    );
  }, []);

  const load = useCallback(
    (grant: ProjectGrant | null) => {
      setState({ status: "loading" });
      void fetchView(grant);
    },
    [fetchView],
  );

  useEffect(() => {
    void getClaudeSnapshot().then(setSnapshot, () => setSnapshot(null));
    void getClaudeEditCatalog().then(setCatalog, () => setCatalog(null));
    void fetchView(null);
  }, [fetchView]);

  const chooseProject = useCallback(() => {
    setSelection({ status: "selecting" });
    selectDirectoryGrant().then(
      (result) => {
        const next = resolveSelection(result, projectGrant);
        setSelection({ status: "idle" });
        if (next !== projectGrant) {
          setProjectGrant(next);
          load(next);
        }
      },
      (error: unknown) => setSelection({ status: "failed", error: decodeAppError(error) }),
    );
  }, [load, projectGrant]);

  const clearProject = useCallback(() => {
    setProjectGrant(null);
    setSelection({ status: "idle" });
    load(null);
  }, [load]);

  const retry = useCallback(() => load(projectGrant), [load, projectGrant]);

  const chooseSettingsFile = useCallback(() => {
    setChoosingFile(true);
    setChooseFileError(null);
    selectFileGrant("CONFIG_FILE").then(
      (result) => {
        setChoosingFile(false);
        if (result.status === "SELECTED") {
          setSettingsFile({ id: result.grant.id, displayPath: result.grant.displayPath });
        }
      },
      (error: unknown) => {
        setChoosingFile(false);
        setChooseFileError(decodeAppError(error));
      },
    );
  }, []);

  return (
    <ClaudeSettingsView
      state={state}
      snapshot={snapshot}
      projectGrant={projectGrant}
      selection={selection}
      onChooseProject={chooseProject}
      onClearProject={clearProject}
      onRetry={retry}
      editing={{
        catalog,
        settingsFile,
        choosing: choosingFile,
        chooseError: chooseFileError,
        onChooseSettingsFile: chooseSettingsFile,
        onSaved: retry,
      }}
    />
  );
}

