import { Panel } from "../../components/ui";
import type { CaddyExposure, CaddyExposureReason, CaddyIssue } from "../../ipc/caddy";
import {
  diffMarker,
  externalExposures,
  type PreviewState,
} from "./caddyRulesModel";

interface CaddyPreviewPanelProps {
  localValid: boolean;
  preview: PreviewState;
  exposures: CaddyExposure[];
}

const EXPOSURE_REASON_TEXT: Record<CaddyExposureReason, string> = {
  LOOPBACK: "回环地址",
  ALL_INTERFACES: "所有网络接口",
  NON_LOOPBACK_ADDRESS: "非回环地址",
  HOST_NAME: "域名",
};

const DIFF_CLASSES = {
  ADDED: "bg-success-soft text-success",
  REMOVED: "bg-danger-soft text-danger",
  UNCHANGED: "text-muted-foreground",
} as const;

function issueLocation(issue: CaddyIssue): string {
  const parts: string[] = [];
  if (issue.site !== undefined) parts.push(`站点 ${issue.site + 1}`);
  if (issue.upstream !== undefined) parts.push(`上游 ${issue.upstream + 1}`);
  return parts.length > 0 ? parts.join(" · ") : "规则";
}

export function CaddyPreviewPanel({ localValid, preview, exposures }: CaddyPreviewPanelProps) {
  return (
    <Panel aria-labelledby="caddy-preview-heading" className="grid min-w-0 gap-ui-8 p-ui-8">
      <h2 id="caddy-preview-heading" className="text-sm font-semibold">
        预览与差异
      </h2>
      <PreviewBody localValid={localValid} preview={preview} exposures={exposures} />
    </Panel>
  );
}

function PreviewBody({ localValid, preview, exposures }: CaddyPreviewPanelProps) {
  if (!localValid) {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        请先修正表单中的输入；修正后会自动生成预览。
      </p>
    );
  }
  if (preview.status === "pending") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在生成预览……
      </p>
    );
  }
  if (preview.status === "failed") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        预览失败：{preview.error.message}
      </p>
    );
  }
  const result = preview.preview;
  if (!result.valid) {
    return (
      <div className="grid gap-ui-8">
        <p role="alert" className="m-0 text-body font-semibold text-danger">
          校验未通过，未生成 Caddyfile 文本。请根据表单中的提示修改。
        </p>
        <ul className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
          {result.validation.issues.map((issue) => (
            <li key={`${issueLocation(issue)}:${issue.code}:${issue.message}`}>
              {issueLocation(issue)}：{issue.message}
            </li>
          ))}
          {result.validation.conflicts.map((conflict) => (
            <li key={`conflict:${conflict.listen}`}>
              冲突：{conflict.listen} 同时被{" "}
              {conflict.sites.map((site) => `站点 ${site + 1}`).join("、")} 启用，请改为不同的监听地址。
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const exposed = externalExposures(exposures);
  return (
    <div className="grid min-w-0 gap-ui-8">
      {exposed.length > 0 ? (
        <section
          aria-labelledby="caddy-exposure-heading"
          className="grid gap-ui-4 rounded-panel bg-warning-soft p-ui-8 text-warning"
        >
          <h3 id="caddy-exposure-heading" className="m-0 text-sm font-semibold">
            对局域网或外部可见
          </h3>
          <p className="m-0 text-aux">
            以下监听地址不是本机回环地址，同一网络中的其他设备或外部可能访问到这些代理。
          </p>
          <ul className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
            {exposed.map((exposure) => (
              <li key={`${exposure.site}:${exposure.listen}`}>
                站点 {exposure.site + 1}：监听 <span className="font-mono">{exposure.listen}</span>
                （{EXPOSURE_REASON_TEXT[exposure.reason]}）
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.validation.issues.length > 0 ? (
        <ul aria-label="校验提示" className="m-0 grid gap-ui-4 pl-ui-8 text-aux text-warning">
          {result.validation.issues.map((issue) => (
            <li key={`${issueLocation(issue)}:${issue.code}`}>
              {issueLocation(issue)}：{issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        {result.hasSavedVersion
          ? "与已保存版本的差异如下。"
          : "尚无已保存版本，下列内容全部为新增。"}
      </p>
      <ol aria-label="Caddyfile 行级差异" className="m-0 grid min-w-0 list-none gap-0 p-0 font-mono text-aux">
        {(result.diff ?? []).map((line, index) => {
          const marker = diffMarker(line.change);
          return (
            <li
              key={index}
              className={`flex min-w-0 gap-ui-8 px-ui-4 ${DIFF_CLASSES[line.change]}`}
            >
              <span aria-hidden="true" className="inline-block w-4 shrink-0 select-none text-center">
                {marker.symbol}
              </span>
              <span className="sr-only">{marker.label}：</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">{line.text}</span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-ui-4">
        <h3 className="m-0 text-sm font-semibold">生成的 Caddyfile</h3>
        <pre
          aria-label="生成的 Caddyfile"
          className="m-0 max-h-72 overflow-auto rounded-control bg-surface-muted p-ui-8 font-mono text-aux"
        >
          {result.generatedText}
        </pre>
      </div>
    </div>
  );
}
