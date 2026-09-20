import {
  Button,
  Panel,
  StatusBadge,
  type StatusBadgeProps,
} from "../../components/ui";
import type {
  ServiceAction,
  ServiceDetails as ServiceDetailsValue,
} from "../../ipc/services";

const STATE_LABELS: Record<ServiceDetailsValue["state"], string> = {
  STARTED: "运行中",
  STOPPED: "已停止",
  ERROR: "错误",
  UNKNOWN: "未知",
};

const VALIDITY_LABELS: Record<ServiceDetailsValue["configValidity"], string> = {
  VALID: "有效",
  INVALID: "无效",
  UNAVAILABLE: "无法验证",
};

const STATE_TONES: Record<
  ServiceDetailsValue["state"],
  StatusBadgeProps["tone"]
> = {
  STARTED: "success",
  STOPPED: "neutral",
  ERROR: "danger",
  UNKNOWN: "warning",
};

const VALIDITY_TONES: Record<
  ServiceDetailsValue["configValidity"],
  StatusBadgeProps["tone"]
> = {
  VALID: "success",
  INVALID: "danger",
  UNAVAILABLE: "warning",
};

const SCOPE_LABELS: Record<ServiceDetailsValue["scope"], string> = {
  USER: "用户级",
  SYSTEM: "系统级",
  UNKNOWN: "未知作用域",
};

export function ServiceDetails({
  details,
  onAction,
}: {
  details: ServiceDetailsValue;
  onAction: (action: ServiceAction) => void;
}) {
  return (
    <Panel
      className="min-h-full p-4"
      aria-labelledby="service-details-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            服务详情
          </p>
          <h3
            id="service-details-heading"
            className="mt-1 text-lg font-semibold tracking-tight"
          >
            {details.displayName}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StatusBadge tone={STATE_TONES[details.state]}>
            {STATE_LABELS[details.state]}
          </StatusBadge>
          <StatusBadge>{SCOPE_LABELS[details.scope]}</StatusBadge>
          {!details.manageable ? (
            <StatusBadge tone="warning">只读</StatusBadge>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <dt>作用域</dt>
          <dd className="mt-1 font-medium">{SCOPE_LABELS[details.scope]}</dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <dt>软件版本</dt>
          <dd className="mt-1 font-medium">
            {details.packageVersion ?? "未知"}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <dt>Caddyfile</dt>
          <dd className="mt-1">
            <StatusBadge tone={VALIDITY_TONES[details.configValidity]}>
              {VALIDITY_LABELS[details.configValidity]}
            </StatusBadge>
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <dt>运行身份</dt>
          <dd className="mt-1 font-medium">{details.user ?? "不可用"}</dd>
        </div>
      </dl>

      {details.configIssue ? (
        <p
          className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
          role="status"
        >
          {details.configIssue}
        </p>
      ) : null}

      {details.manageable ? (
        <div
          className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4"
          aria-label={`${SCOPE_LABELS[details.scope]}服务操作`}
        >
          <Button
            size="sm"
            onClick={() => onAction("START")}
          >
            启动
          </Button>
          <Button
            size="sm"
            onClick={() => onAction("STOP")}
          >
            停止
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={details.configValidity !== "VALID"}
            onClick={() => onAction("RESTART")}
          >
            重启
          </Button>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border bg-surface-muted p-3">
          <p className="text-sm text-muted-foreground">
            此服务仅供查看，不提供启动、停止或重启操作。
          </p>
        </div>
      )}
    </Panel>
  );
}
