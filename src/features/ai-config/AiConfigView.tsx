import { Button, Panel, StatusBadge } from "../../components/ui";
import type { AiToolReport } from "../../ipc/aiConfig";
import {
  CONFIG_LABELS,
  INSTALL_LABELS,
  INVALID_REASON_TEXT,
  NO_EXECUTABLE_TEXT,
  UNCONFIRMED_VERSION_TEXT,
  countInconclusive,
  summarizeState,
  type AiConfigState,
  type AiConfigSummary,
} from "./aiConfigModel";

export interface AiConfigViewProps {
  state: AiConfigState;
  onRetry: () => void;
}

export function AiConfigView({ state, onRetry }: AiConfigViewProps) {
  const summary = summarizeState(state);
  return (
    <div className="grid min-w-0 gap-ui-xl">
      <div className="flex flex-wrap items-center justify-between gap-ui-sm">
        <p className="m-0 text-aux text-muted-foreground">
          只读检测四个 AI 命令行工具。版本检测只运行固定的 --version，不读取凭据、不发起模型请求。配置文件存在不等于已安装，两者分开显示。
        </p>
        <Button size="sm" variant="secondary" disabled={state.status === "loading"} onClick={onRetry}>
          重新检测
        </Button>
      </div>
      <StateNotice state={state} summary={summary} onRetry={onRetry} />
      {state.status === "ready" ? (
        <div className="grid min-w-0 gap-ui-xl md:grid-cols-2">
          {state.report.tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}
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
      <Panel role="alert" className="grid gap-ui-sm p-ui-lg">
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

function ToolCard({ tool }: { tool: AiToolReport }) {
  const headingId = `ai-tool-${tool.id}`;
  const install = INSTALL_LABELS[tool.installStatus];
  const config = CONFIG_LABELS[tool.configPresence];
  return (
    <Panel aria-labelledby={headingId} className="grid content-start gap-ui-md p-ui-lg">
      <h2 id={headingId} className="m-0 text-group font-semibold">
        {tool.displayName}
      </h2>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-lg gap-y-ui-sm text-body">
        <dt className="text-muted-foreground">安装状态</dt>
        <dd className="m-0 grid min-w-0 justify-items-start gap-ui-xs">
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
          <ul className="m-0 grid list-none gap-ui-xs p-0">
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
