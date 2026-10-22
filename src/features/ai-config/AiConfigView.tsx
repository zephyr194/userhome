import type { ReactNode } from "react";
import { useBoardView } from "../../app/BoardViewContext";
import { useToolSection } from "../../app/SectionContext";
import { Button, PageShell, Panel, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type { BoardSpan } from "../../components/ui/PageShell";
import type { AiToolReport } from "../../ipc/aiConfig";
import { ToolReference } from "./ToolReference";
import {
  AI_CONFIG_DEFAULT_SECTION,
  CONFIG_LABELS,
  INSTALL_LABELS,
  INVALID_REASON_TEXT,
  NO_EXECUTABLE_TEXT,
  UNCONFIRMED_VERSION_TEXT,
  countInconclusive,
  sectionForTool,
  selectedToolOf,
  showsClaudePanel,
  summarizeState,
  toolIdForSection,
  type AiConfigState,
  type AiConfigSummary,
} from "./aiConfigModel";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";

export interface AiConfigViewProps {
  state: AiConfigState;
  onRetry: () => void;
  /** Claude Code settings and command panels, supplied by the page; hidden while another tool is selected. */
  claudePanel?: ReactNode;
}

export function AiConfigView({ state, onRetry, claudePanel }: AiConfigViewProps) {
  const { isBoard } = useBoardView();
  const [section, setSection] = useToolSection(AI_CONFIG_DEFAULT_SECTION);
  const summary = summarizeState(state);
  const tools = state.status === "ready" ? state.report.tools : [];
  const selected = selectedToolOf(tools, toolIdForSection(section));
  const showClaudePanel = showsClaudePanel(selected);
  const toolListRef = useSlideIndicator(selected?.id);

  return (
    <PageShell
      layout={isBoard ? "board" : "master-detail"}
      scrollKey={isBoard ? "board" : "compact"}
    >
      <Region span={isBoard ? 4 : undefined}>
        <Panel
          aria-labelledby="ai-tools-heading"
          className="grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
            <h2 id="ai-tools-heading" className="m-0 text-group font-semibold">
              AI 工具
            </h2>
            <Button
              size="sm"
              variant="secondary"
              disabled={state.status === "loading"}
              onClick={onRetry}
            >
              重新检测
            </Button>
          </div>
          <p className="m-0 text-aux text-muted-foreground">
            只读检测四个 AI 命令行工具。版本检测只运行固定的 --version，不读取凭据、不发起模型请求。配置文件存在不等于已安装，两者分开显示。
          </p>
          <StateNotice state={state} summary={summary} onRetry={onRetry} />
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
                    onSelect={(toolId) => setSection(sectionForTool(toolId))}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </Region>

      <Region span={isBoard ? 8 : undefined}>
        <section
          aria-label="所选工具"
          className="grid min-h-0 min-w-0 content-start gap-ui-12 overflow-y-auto overscroll-contain p-ui-12"
        >
          {selected ? <ToolCard tool={selected} /> : null}
          {selected && !showClaudePanel ? (
            <ToolReference key={selected.id} toolId={selected.id} />
          ) : null}
          <div hidden={!showClaudePanel}>
            <div className="grid min-w-0 gap-ui-12">{claudePanel}</div>
          </div>
        </section>
      </Region>
    </PageShell>
  );
}

/** Same element in both views, so switching views never remounts the panes. */
function Region({ span, children }: { span?: BoardSpan; children: ReactNode }) {
  return (
    <div
      className={classNames(
        "grid min-h-0 min-w-0",
        span !== undefined && `page-shell__cell page-shell__cell--span-${span}`,
      )}
    >
      {children}
    </div>
  );
}

function StateNotice({
  state,
  summary,
  onRetry,
}: {
  state: AiConfigState;
  summary: AiConfigSummary;
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
  const config = CONFIG_LABELS[tool.configPresence];
  return (
    <Button
      variant="ghost"
      size="sm"
      className="slide-item ai-tool-row"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(tool.id)}
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <strong className="text-body font-semibold">{tool.displayName}</strong>
        <StatusBadge tone={install.tone}>
          <span aria-hidden="true">{install.symbol} </span>
          {install.label}
        </StatusBadge>
      </span>
      {tool.invalidReason ? (
        <span className="text-aux">{INVALID_REASON_TEXT[tool.invalidReason]}</span>
      ) : null}
      <span className="break-all font-mono text-aux">
        {tool.displayPath ?? NO_EXECUTABLE_TEXT}
      </span>
      <span className="break-all font-mono text-aux">
        {tool.version ?? UNCONFIRMED_VERSION_TEXT}
      </span>
      <span className="text-aux">
        <span aria-hidden="true">{config.symbol} </span>
        {config.text}
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
