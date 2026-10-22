import { Button, StatusBadge } from "../../components/ui";
import type { CaddyDetectReport } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { candidateOutcomeText } from "./caddyRulesModel";

export type DetectState =
  | { status: "loading" }
  | { status: "ready"; report: CaddyDetectReport }
  | { status: "failed"; error: AppError };

interface CaddyDetectPanelProps {
  state: DetectState;
  onRetry: () => void;
}

export function CaddyDetectPanel({ state, onRetry }: CaddyDetectPanelProps) {
  return (
    <section aria-labelledby="caddy-detect-heading" className="caddy-status__cell grid min-w-0 content-start gap-ui-4">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <h2 id="caddy-detect-heading" className="text-sm font-semibold">
          Caddy 检测
        </h2>
        <DetectSummary state={state} />
        <Button size="sm" variant="secondary" disabled={state.status === "loading"} onClick={onRetry}>
          重新检测
        </Button>
      </div>
      <p className="caddy-status__line m-0 min-w-0 text-aux text-muted-foreground">
        <DetectLine state={state} />
      </p>
      <details className="text-aux">
        <summary className="cursor-pointer text-muted-foreground">检测详情</summary>
        <div className="mt-ui-4 grid gap-ui-8">
          <p className="m-0 text-aux text-muted-foreground">
            版本检测不是安全保证：它只说明该文件能运行 caddy version，不代表文件可信或与你的配置兼容。
          </p>
          {state.status === "ready" ? <CandidateList report={state.report} /> : null}
        </div>
      </details>
    </section>
  );
}

function DetectSummary({ state }: { state: DetectState }) {
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在检测 Caddy……
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        检测失败
      </p>
    );
  }
  const { report } = state;
  if (report.status === "AVAILABLE") {
    return (
      <>
        <StatusBadge tone="success">已找到</StatusBadge>
        <span className="min-w-0 truncate font-mono text-aux" title={report.version}>
          {report.version}
        </span>
      </>
    );
  }
  return (
    <StatusBadge tone={report.status === "MISSING" ? "warning" : "danger"}>
      {report.status === "MISSING" ? "未找到" : "不可用"}
    </StatusBadge>
  );
}

function DetectLine({ state }: { state: DetectState }) {
  if (state.status === "loading") return <>检测完成后显示 Caddy 的路径和版本。</>;
  if (state.status === "failed") return <>{state.error.message}</>;
  const { report } = state;
  if (report.status === "AVAILABLE") {
    return (
      <span className="block truncate font-mono text-foreground" title={report.executablePath}>
        {report.executablePath}
      </span>
    );
  }
  return <>{report.guidance}</>;
}

function CandidateList({ report }: { report: CaddyDetectReport }) {
  return (
    <ul aria-label="检测过的位置" className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
      {report.candidates.map((candidate) => (
        <li key={`${candidate.source}:${candidate.displayPath}`} className="break-all">
          <span className="font-mono">{candidate.displayPath}</span>：
          {candidateOutcomeText(candidate.outcome)}
        </li>
      ))}
    </ul>
  );
}
