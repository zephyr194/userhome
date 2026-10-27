import type { ReactNode } from "react";
import { ActionRow, Button, PageShell, Panel, StatusBadge } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import type { AiToolReport } from "../../ipc/aiConfig";
import type { AppError } from "../../ipc/core";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import { BrewUpdate } from "./BrewUpdate";
import { ConfigSearchBar } from "./ConfigSearchControls";
import { ConfigFileViewer } from "./ConfigFileViewer";
import { ToolReference } from "./ToolReference";
import {
  CONFIG_LABELS,
  INSTALL_LABELS,
  INVALID_REASON_KEYS,
  NO_CONFIG_PATH_KEY,
  NO_EXECUTABLE_KEY,
  UNCONFIRMED_VERSION_KEY,
  countInconclusive,
  selectedToolOf,
  showsClaudePanel,
  summarizeState,
  type AiConfigState,
  type AiConfigSummary,
} from "./aiConfigModel";
import { countMatches, searchTerms } from "./configSearch";
import type { ToolSearchIndex } from "./configSearchStore";

export interface AiConfigViewProps {
  state: AiConfigState;
  /** A refresh is running over the report that is already shown. */
  refreshing?: boolean;
  /** The last refresh failed; the report it kept stays on screen. */
  refreshError?: AppError;
  selectedToolId: string;
  onSelectTool: (toolId: string) => void;
  onRefresh: () => void;
  /** Claude Code settings and command panels, supplied by the page; hidden while another tool is selected. */
  claudePanel?: ReactNode;
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Searchable items per tool; a tool missing from the map has not been loaded yet. */
  searchIndex?: ToolSearchIndex;
}

const NO_SEARCH_INDEX: ToolSearchIndex = new Map();

export function AiConfigView({
  state,
  refreshing = false,
  refreshError,
  selectedToolId,
  onSelectTool,
  onRefresh,
  claudePanel,
  query = "",
  onQueryChange = () => undefined,
  searchIndex = NO_SEARCH_INDEX,
}: AiConfigViewProps) {
  const t = useT();
  const summary = summarizeState(state);
  const tools = state.status === "ready" ? state.report.tools : [];
  const selected = selectedToolOf(tools, selectedToolId);
  const showClaudePanel = showsClaudePanel(selected);
  const toolListRef = useSlideIndicator(selected?.id);
  const terms = searchTerms(query);
  const searching = terms.length > 0;
  const countFor = (toolId: string): number | undefined => {
    const items = searchIndex.get(toolId);
    return items === undefined ? undefined : countMatches(items, terms);
  };
  const selectedCount = selected && searching ? countFor(selected.id) : undefined;
  const otherTools = tools
    .filter((tool) => tool.id !== selected?.id)
    .map((tool) => ({ tool, count: countFor(tool.id) }));
  const otherMatches = otherTools.filter((other) => (other.count ?? 0) > 0);

  return (
    <PageShell layout="master-detail" scrollKey="compact">
      <PageRegion>
        <Panel
          aria-labelledby="ai-tools-heading"
          className="r4-fe4-scroll grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          <h2 id="ai-tools-heading" className="m-0 text-group font-semibold">
            {t("aiConfig.view.toolListHeading")}
          </h2>
          <p className="m-0 text-aux text-muted-foreground">
            {t("aiConfig.view.toolListIntro")}
          </p>
          <StateNotice
            state={state}
            summary={summary}
            refreshing={refreshing}
            refreshError={refreshError}
            onRetry={onRefresh}
          />
          {state.status === "loading" ? <ToolSkeleton /> : null}
          {state.status === "ready" ? (
            <ul
              ref={toolListRef}
              aria-label={t("aiConfig.view.toolListLabel")}
              className="motion-enter slide-list m-0 grid list-none gap-ui-4 p-0"
            >
              {tools.map((tool) => (
                <li key={tool.id}>
                  <ToolRow
                    tool={tool}
                    selected={tool.id === selected?.id}
                    onSelect={onSelectTool}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </PageRegion>

      <PageRegion>
        <section
          aria-label={t("aiConfig.view.selectedToolLabel")}
          className="r4-fe4-scroll grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          <ConfigSearchBar
            query={query}
            matchCount={selectedCount}
            onQueryChange={onQueryChange}
          />
          {searching && selectedCount === 0 ? (
            <SearchEmpty
              unloadedCount={otherTools.filter((other) => other.count === undefined).length}
              matches={otherMatches.map((other) => ({
                toolId: other.tool.id,
                displayName: other.tool.displayName,
                count: other.count ?? 0,
              }))}
              onSelectTool={onSelectTool}
            />
          ) : null}
          {selected ? <ToolCard key={selected.id} tool={selected} onRefresh={onRefresh} /> : null}
          {selected && !showClaudePanel ? (
            <ToolReference key={selected.id} toolId={selected.id} query={query} />
          ) : null}
          <div hidden={!showClaudePanel}>
            <div className="grid min-w-0 gap-ui-12">{claudePanel}</div>
          </div>
        </section>
      </PageRegion>
    </PageShell>
  );
}

function StateNotice({
  state,
  summary,
  refreshing,
  refreshError,
  onRetry,
}: {
  state: AiConfigState;
  summary: AiConfigSummary;
  refreshing: boolean;
  refreshError: AppError | undefined;
  onRetry: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (state.status === "failed") {
    return (
      <Panel role="alert" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body font-semibold text-danger">{t("aiConfig.view.detectFailed")}</p>
        <p className="m-0 text-body">{localizeError(state.error, locale)}</p>
        <div>
          <Button variant="danger" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Panel>
    );
  }
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("aiConfig.view.detecting")}
      </p>
    );
  }
  if (refreshError) {
    return (
      <Panel role="alert" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body font-semibold text-danger">{t("aiConfig.view.refreshFailed")}</p>
        <p className="m-0 text-body">{localizeError(refreshError, locale)}</p>
        <p className="m-0 text-aux text-muted-foreground">{t("aiConfig.view.refreshFailedHint")}</p>
        <div>
          <Button variant="danger" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Panel>
    );
  }
  if (refreshing) {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("aiConfig.view.refreshing")}
      </p>
    );
  }
  if (summary === "empty") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("aiConfig.view.noTools")}
      </p>
    );
  }
  if (state.status === "ready" && summary === "partial") {
    return (
      <p role="status" className="m-0 text-body">
        {t("aiConfig.view.partial", { count: countInconclusive(state.report) })}
      </p>
    );
  }
  return null;
}

function SearchEmpty({
  matches,
  unloadedCount,
  onSelectTool,
}: {
  matches: { toolId: string; displayName: string; count: number }[];
  unloadedCount: number;
  onSelectTool: (toolId: string) => void;
}) {
  const t = useT();
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  let otherText = t("aiConfig.view.noOtherMatches");
  if (total > 0) otherText = t("aiConfig.view.otherMatches", { count: total });
  else if (unloadedCount > 0) otherText = t("aiConfig.view.noOpenedMatches");
  return (
    <section aria-label={t("aiConfig.view.searchResults")} className="grid min-w-0 justify-items-start gap-ui-8">
      <p className="m-0 text-body font-semibold">{t("aiConfig.view.noMatchingSettings")}</p>
      <p className="m-0 text-aux text-muted-foreground">{otherText}</p>
      {matches.length > 0 ? (
        <ActionRow>
          {matches.map((match) => (
            <Button
              key={match.toolId}
              variant="default"
              onClick={() => onSelectTool(match.toolId)}
            >
              {t("aiConfig.view.openTool", { name: match.displayName, count: match.count })}
            </Button>
          ))}
        </ActionRow>
      ) : null}
      {unloadedCount > 0 ? (
        <p className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.view.unloadedTools", { count: unloadedCount })}
        </p>
      ) : null}
    </section>
  );
}

function ToolSkeleton() {
  return (
    <ul aria-hidden="true" className="m-0 grid list-none gap-ui-4 p-0">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="ai-tool-row ai-tool-skeleton">
          <span className="ai-tool-skeleton__bar ai-tool-skeleton__bar--name" />
          <span className="ai-tool-skeleton__bar ai-tool-skeleton__bar--status" />
        </li>
      ))}
    </ul>
  );
}

function ToolRow({
  tool,
  selected,
  onSelect,
}: {
  tool: AiToolReport;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const install = INSTALL_LABELS[tool.installStatus];
  return (
    <Button
      variant="ghost"
      className="slide-item ai-tool-row"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(tool.id)}
    >
      <strong className="min-w-0 text-body font-semibold">{tool.displayName}</strong>
      <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <StatusBadge tone={install.tone}>
          <span aria-hidden="true">{install.symbol} </span>
          {t(install.labelKey)}
        </StatusBadge>
        {tool.invalidReason ? (
          <span className="text-aux">{t(INVALID_REASON_KEYS[tool.invalidReason])}</span>
        ) : null}
      </span>
    </Button>
  );
}

function ToolCard({ tool, onRefresh }: { tool: AiToolReport; onRefresh: () => void }) {
  const headingId = `ai-tool-${tool.id}`;
  const t = useT();
  const install = INSTALL_LABELS[tool.installStatus];
  const config = CONFIG_LABELS[tool.configPresence];
  return (
    <Panel aria-labelledby={headingId} className="grid content-start gap-ui-8 p-ui-8">
      <h3 id={headingId} className="m-0 text-group font-semibold">
        {tool.displayName}
      </h3>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-8 gap-y-ui-8 text-body">
        <dt className="text-muted-foreground">{t("aiConfig.view.installStatus")}</dt>
        <dd className="m-0 grid min-w-0 justify-items-start gap-ui-4">
          <StatusBadge tone={install.tone}>
            <span aria-hidden="true">{install.symbol} </span>
            {t(install.labelKey)}
          </StatusBadge>
          {tool.invalidReason ? (
            <span className="text-aux">{t(INVALID_REASON_KEYS[tool.invalidReason])}</span>
          ) : null}
        </dd>
        {tool.installSource ? (
          <>
            <dt className="text-muted-foreground">{t("aiConfig.view.installSource")}</dt>
            <dd className="m-0 grid min-w-0 justify-items-start gap-ui-8">
              {tool.installSource.type === "homebrew" ? (
                <>
                  <span className="break-all">
                    {t("aiConfig.install.homebrew", {
                      kind: tool.installSource.kind === "CASK" ? "cask" : "formula",
                      package: tool.installSource.package,
                    })}
                  </span>
                  <BrewUpdate
                    toolId={tool.id}
                    displayName={tool.displayName}
                    packageName={tool.installSource.package}
                    onRefreshed={onRefresh}
                  />
                </>
              ) : (
                <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
                  <span>{t("aiConfig.view.directInstall")}</span>
                  <span className="text-aux text-muted-foreground">
                    {t("aiConfig.view.directInstallNote")}
                  </span>
                </span>
              )}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("aiConfig.view.executable")}</dt>
        <dd className="m-0 break-all font-mono text-aux">
          {tool.displayPath ?? t(NO_EXECUTABLE_KEY)}
        </dd>
        <dt className="text-muted-foreground">{t("aiConfig.view.version")}</dt>
        <dd className="m-0 break-all font-mono text-aux">
          {tool.version ?? t(UNCONFIRMED_VERSION_KEY)}
        </dd>
        <dt className="text-muted-foreground">{t("aiConfig.view.configFile")}</dt>
        <dd className="m-0">
          <span aria-hidden="true">{config.symbol} </span>
          {t(config.textKey)}
        </dd>
        <dt className="text-muted-foreground">{t("aiConfig.view.configPath")}</dt>
        <dd className="m-0 break-all font-mono text-aux">
          {tool.configDisplayPath ?? t(NO_CONFIG_PATH_KEY)}
        </dd>
        <dt className="text-muted-foreground">{t("aiConfig.view.officialReferences")}</dt>
        <dd className="m-0 min-w-0">
          <ul className="m-0 grid list-none gap-ui-4 p-0">
            {tool.references.map((url) => (
              <li key={url} className="break-all font-mono text-aux">
                {url}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      {tool.configDisplayPath ? <ConfigFileViewer toolId={tool.id} /> : null}
      <p className="m-0 text-aux text-muted-foreground">{tool.verificationNote}</p>
    </Panel>
  );
}
