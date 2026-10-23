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
import { HighlightText } from "./ConfigSearchControls";
import { claudeSearchItems, matchesSearch, searchTerms, type SearchItem } from "./configSearch";
import { publishToolSearchItems } from "./configSearchStore";
import { CLAUDE_CODE_TOOL_ID } from "./aiConfigModel";
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
  readonly query?: string;
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
  query = "",
}: ClaudeSettingsViewProps) {
  const busy = state.status === "loading" || selection.status === "selecting";
  const terms = searchTerms(query);
  return (
    <section className="grid min-w-0 gap-ui-8" aria-label="Claude Code 设置">
      <header className="grid gap-ui-4">
        <h2 className="m-0 text-body font-semibold">Claude Code 设置</h2>
        <p className="m-0 text-aux text-muted-foreground">
          仅展示官方设置文件的内容与覆盖关系，不运行钩子、MCP 服务或项目命令，不修改信任设置。
          哪些设置可以修改由应用逐项判断，不能修改的会说明原因。
        </p>
        {snapshot ? (
          <p className="m-0 text-aux text-muted-foreground">
            来源：{snapshot.sourceUrl}（抓取日期 {snapshot.retrievedOn}，适用版本
            {snapshot.documentedVersion === "unknown" ? "未知" : snapshot.documentedVersion}）；
            已收录 {snapshot.settingCount} 个设置、{snapshot.resourceCount} 个来源，
            其中 {snapshot.editable} 项可以修改。
          </p>
        ) : (
          <p className="m-0 text-aux text-muted-foreground">定义摘要不可用。</p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-ui-8">
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
        <div className="grid justify-items-start gap-ui-4" role="alert">
          <p className="m-0 text-aux text-danger">{state.error.message}</p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onRetry}>
            重新读取
          </Button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <ReadResult
          view={state.view}
          terms={terms}
          catalogItems={editing?.catalog?.items ?? []}
        />
      ) : null}
      {editing ? (
        <EditPanel
          {...editing}
          view={state.status === "ready" ? state.view : null}
          query={query}
        />
      ) : null}
    </section>
  );
}

function ReadResult({
  view,
  terms,
  catalogItems,
}: {
  readonly view: ClaudeReadView;
  readonly terms: readonly string[];
  readonly catalogItems: NonNullable<EditingState["catalog"]>["items"];
}) {
  const searchable = new Map<string, SearchItem>(
    claudeSearchItems(
      view.entries.map((entry) => entry.key),
      catalogItems,
    ).map((item) => [item.keyPath, item]),
  );
  const shownEntries = view.entries.filter((entry) => {
    const item = searchable.get(entry.key);
    return item === undefined || matchesSearch(item, terms);
  });
  return (
    <div className="grid min-w-0 gap-ui-8">
      {isPartialView(view) ? (
        <p className="m-0 text-aux text-danger" role="status">
          部分来源不可读或存在解析问题，结果可能不完整。
        </p>
      ) : null}

      <section aria-label="来源层级" className="grid gap-ui-4">
        <h3 className="m-0 text-aux font-semibold">来源层级（按覆盖顺序，自上而下优先）</h3>
        <ol className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
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
        <ul aria-label="解析警告" className="m-0 grid gap-ui-4 pl-ui-8 text-aux text-danger">
          {view.warnings.map((warning, index) => (
            <li key={`${warning.layerId}-${warning.key}-${index}`}>
              {layerTitle(warning.layerId)} · {warning.key}：{warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {view.entries.length === 0 ? (
        <p className="m-0 text-aux text-muted-foreground">未发现已设置的键。</p>
      ) : shownEntries.length === 0 ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          没有匹配的设置键。
        </p>
      ) : (
        <ul aria-label="设置键" className="m-0 grid list-none gap-ui-8 p-0">
          {shownEntries.map((entry) => (
            <li key={entry.key} className="grid gap-ui-4 border-t border-border pt-ui-8">
              <div className="flex flex-wrap items-baseline gap-ui-8">
                <code className="text-aux font-semibold">
                  <HighlightText text={entry.key} terms={terms} />
                </code>
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

export function ToolSettings({ query = "" }: { readonly query?: string }) {
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

  useEffect(() => {
    if (state.status !== "ready") return;
    publishToolSearchItems(
      CLAUDE_CODE_TOOL_ID,
      claudeSearchItems(
        state.view.entries.map((entry) => entry.key),
        catalog?.items ?? [],
      ),
    );
  }, [state, catalog]);

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
      query={query}
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

