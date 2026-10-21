import { Button, Panel, StatusBadge } from "../../components/ui";
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
    <Panel aria-labelledby="caddy-detect-heading" className="grid gap-ui-md p-ui-lg">
      <div className="flex flex-wrap items-center justify-between gap-ui-sm">
        <h2 id="caddy-detect-heading" className="text-sm font-semibold">
          Caddy 检测
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
      <DetectBody state={state} />
      <p className="m-0 text-aux text-muted-foreground">
        版本检测不是安全保证：它只说明该文件能运行 caddy version，不代表文件可信或与你的配置兼容。
      </p>
    </Panel>
  );
}

function DetectBody({ state }: { state: DetectState }) {
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
        检测失败：{state.error.message}
      </p>
    );
  }
  const { report } = state;
  return (
    <div className="grid gap-ui-sm">
      {report.status === "AVAILABLE" ? (
        <>
          <div>
            <StatusBadge tone="success">已找到</StatusBadge>
          </div>
          <dl className="m-0 grid gap-ui-sm text-body">
            <div className="grid gap-ui-xs">
              <dt className="text-aux text-muted-foreground">可执行文件</dt>
              <dd className="m-0 break-all font-mono text-aux">{report.executablePath}</dd>
            </div>
            <div className="grid gap-ui-xs">
              <dt className="text-aux text-muted-foreground">版本</dt>
              <dd className="m-0 break-all font-mono text-aux">{report.version}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <div>
            <StatusBadge tone={report.status === "MISSING" ? "warning" : "danger"}>
              {report.status === "MISSING" ? "未找到" : "不可用"}
            </StatusBadge>
          </div>
          <p className="m-0 text-body">{report.guidance}</p>
        </>
      )}
      <ul aria-label="检测过的位置" className="m-0 grid gap-ui-xs pl-ui-lg text-aux">
        {report.candidates.map((candidate) => (
          <li key={`${candidate.source}:${candidate.displayPath}`} className="break-all">
            <span className="font-mono">{candidate.displayPath}</span>：
            {candidateOutcomeText(candidate.outcome)}
          </li>
        ))}
      </ul>
    </div>
  );
}
