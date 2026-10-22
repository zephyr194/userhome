import type { ReactNode } from "react";
import { Button, PageShell, Panel, StatusBadge } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import type { AiToolReport } from "../../ipc/aiConfig";
import type { AppError } from "../../ipc/core";
import { ToolReference } from "./ToolReference";
import {
  CONFIG_LABELS,
  INSTALL_LABELS,
  INVALID_REASON_TEXT,
  NO_EXECUTABLE_TEXT,
  UNCONFIRMED_VERSION_TEXT,
  countInconclusive,
  selectedToolOf,
  showsClaudePanel,
  summarizeState,
  type AiConfigState,
  type AiConfigSummary,
} from "./aiConfigModel";

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
}

export function AiConfigView({
  state,
  refreshing = false,
  refreshError,
  selectedToolId,
  onSelectTool,
  onRefresh,
  claudePanel,
}: AiConfigViewProps) {
  const summary = summarizeState(state);
  const tools = state.status === "ready" ? state.report.tools : [];
  const selected = selectedToolOf(tools, selectedToolId);
  const showClaudePanel = showsClaudePanel(selected);
  const toolListRef = useSlideIndicator(selected?.id);
  const busy = state.status === "loading" || refreshing;

  return (
    <PageShell layout="master-detail" scrollKey="compact">
      <PageRegion>
        <Panel
          aria-labelledby="ai-tools-heading"
          className="r4-fe4-scroll grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
            <h2 id="ai-tools-heading" className="m-0 text-group font-semibold">
              工具列表
            </h2>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onRefresh}>
              刷新
            </Button>
          </div>
          <p className="m-0 text-aux text-muted-foreground">
            只读检测四个 AI 命令行工具。版本检测只运行固定的 --version，不读取凭据、不发起模型请求。配置文件存在不等于已安装，两者分开显示。
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
              aria-label="AI 工具列表"
              className="slide-list m-0 grid list-none gap-ui-4 p-0"
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
          aria-label="所选工具"
          className="r4-fe4-scroll grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          {selected ? <ToolCard tool={selected} /> : null}
          {selected && !showClaudePanel ? (
            <ToolReference key={selected.id} toolId={selected.id} />
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
  if (state.status === "failed") {
    return (
      <Panel role="alert" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body font-semibold text-danger">无法检测 AI 工具</p>
        <p className="m-0 text-body">{state.error.message}</p>
        <div>
          <Button size="sm" onClick={onRetry}>
            重试
          </Button>
        </div>
      </Panel>
    );
  }
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在检测 AI 工具……
      </p>
    );
  }
  if (refreshError) {
    return (
      <Panel role="alert" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body font-semibold text-danger">刷新失败，仍显示上次读取的结果</p>
        <p className="m-0 text-body">{refreshError.message}</p>
        <div>
          <Button size="sm" onClick={onRetry}>
            重试
          </Button>
        </div>
      </Panel>
    );
  }
  if (refreshing) {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在刷新…
      </p>
    );
  }
  if (summary === "empty") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        没有可检测的 AI 工具。
      </p>
    );
  }
  if (state.status === "ready" && summary === "partial") {
    return (
      <p role="status" className="m-0 text-body">
        有 {countInconclusive(state.report)} 个工具无法完整检测（安装无效或配置无法检查），其余工具不受影响。
      </p>
    );
  }
  return null;
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
  const install = INSTALL_LABELS[tool.installStatus];
  return (
    <Button
      variant="ghost"
      size="sm"
      className="slide-item ai-tool-row"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(tool.id)}
    >
      <strong className="min-w-0 text-body font-semibold">{tool.displayName}</strong>
      <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <StatusBadge tone={install.tone}>
          <span aria-hidden="true">{install.symbol} </span>
          {install.label}
        </StatusBadge>
        {tool.invalidReason ? (
          <span className="text-aux">{INVALID_REASON_TEXT[tool.invalidReason]}</span>
        ) : null}
      </span>
    </Button>
  );
}

function ToolCard({ tool }: { tool: AiToolReport }) {
  const headingId = `ai-tool-${tool.id}`;
  const install = INSTALL_LABELS[tool.installStatus];
  const config = CONFIG_LABELS[tool.configPresence];
  return (
    <Panel aria-labelledby={headingId} className="grid content-start gap-ui-8 p-ui-8">
      <h3 id={headingId} className="m-0 text-group font-semibold">
        {tool.displayName}
      </h3>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-8 gap-y-ui-8 text-body">
        <dt className="text-muted-foreground">安装状态</dt>
        <dd className="m-0 grid min-w-0 justify-items-start gap-ui-4">
          <StatusBadge tone={install.tone}>
            <span aria-hidden="true">{install.symbol} </span>
            {install.label}
          </StatusBadge>
          {tool.invalidReason ? (
            <span className="text-aux">{INVALID_REASON_TEXT[tool.invalidReason]}</span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">可执行文件</dt>
        <dd className="m-0 break-all font-mono text-aux">
          {tool.displayPath ?? NO_EXECUTABLE_TEXT}
        </dd>
        <dt className="text-muted-foreground">版本</dt>
        <dd className="m-0 break-all font-mono text-aux">
          {tool.version ?? UNCONFIRMED_VERSION_TEXT}
        </dd>
        <dt className="text-muted-foreground">配置文件</dt>
        <dd className="m-0">
          <span aria-hidden="true">{config.symbol} </span>
          {config.text}
        </dd>
        <dt className="text-muted-foreground">官方参考</dt>
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
      <p className="m-0 text-aux text-muted-foreground">{tool.verificationNote}</p>
    </Panel>
  );
}
