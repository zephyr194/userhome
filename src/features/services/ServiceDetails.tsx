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
  const canManage = details.manageable && details.scope !== "UNKNOWN";

  return (
    <Panel
      className="min-w-0"
      aria-labelledby="service-details-heading"
      ticks
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-xl border-b border-border px-ui-3xl py-ui-xl">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            服务详情
          </p>
          <h3
            className="mt-ui-xs break-words text-lg font-semibold [overflow-wrap:anywhere]"
            id="service-details-heading"
          >
            {details.displayName}
          </h3>
          <p className="mt-ui-xs break-all font-mono text-xs text-muted-foreground">
            {details.serviceId}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-ui-sm">
          <StatusBadge>{SCOPE_LABELS[details.scope]}</StatusBadge>
          {!canManage ? (
            <StatusBadge tone="warning">只读</StatusBadge>
          ) : null}
        </div>
      </header>

      <dl className="grid min-w-0 grid-cols-1 overflow-hidden border-b border-border bg-border sm:grid-cols-2 sm:gap-px">
        <div className="min-w-0 border-b border-border bg-surface-muted px-ui-xl py-ui-lg sm:border-b-0">
          <dt className="text-xs text-muted-foreground">运行状态</dt>
          <dd className="mt-ui-xs">
            <StatusBadge tone={STATE_TONES[details.state]}>
              {STATE_LABELS[details.state]}
            </StatusBadge>
          </dd>
        </div>
        <div className="min-w-0 border-b border-border bg-surface-muted px-ui-xl py-ui-lg sm:border-b-0">
          <dt className="text-xs text-muted-foreground">作用域</dt>
          <dd className="mt-ui-xs break-words text-sm font-medium">
            {SCOPE_LABELS[details.scope]}
          </dd>
        </div>
        <div className="min-w-0 border-b border-border bg-surface-muted px-ui-xl py-ui-lg sm:border-b-0">
          <dt className="text-xs text-muted-foreground">软件版本</dt>
          <dd className="mt-ui-xs break-all text-sm font-medium">
            {details.packageVersion ?? "未知"}
          </dd>
        </div>
        <div className="min-w-0 border-b border-border bg-surface-muted px-ui-xl py-ui-lg sm:border-b-0">
          <dt className="text-xs text-muted-foreground">配置有效性</dt>
          <dd className="mt-ui-xs flex flex-wrap items-center gap-ui-sm">
            <StatusBadge tone={VALIDITY_TONES[details.configValidity]}>
              {VALIDITY_LABELS[details.configValidity]}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">Caddyfile</span>
          </dd>
        </div>
        <div className="min-w-0 bg-surface-muted px-ui-xl py-ui-lg">
          <dt className="text-xs text-muted-foreground">运行身份</dt>
          <dd className="mt-ui-xs break-all text-sm font-medium">
            {details.user ?? "不可用"}
          </dd>
        </div>
      </dl>

      {details.configIssue ? (
        <p
          className="mx-ui-3xl mt-ui-xl break-words rounded-control border border-warning-border bg-warning-soft px-ui-xl py-ui-lg text-xs leading-relaxed text-warning [overflow-wrap:anywhere]"
          role="status"
        >
          {details.configIssue}
        </p>
      ) : null}

      {canManage ? (
        <div
          className="sticky bottom-0 mt-ui-xl flex flex-wrap justify-end gap-ui-md border-t border-line bg-surface px-ui-3xl py-ui-xl"
          aria-label={`${SCOPE_LABELS[details.scope]}服务操作`}
        >
          <Button
            size="sm"
            variant="primary"
            disabled={details.configValidity !== "VALID"}
            onClick={() => onAction("RESTART")}
          >
            重启
          </Button>
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
        </div>
      ) : (
        <div className="m-ui-3xl rounded-control border border-dashed border-border bg-surface-muted px-ui-xl py-ui-lg">
          <p className="text-sm text-muted-foreground">
            此服务仅供查看，不提供启动、停止或重启操作。
          </p>
        </div>
      )}
    </Panel>
  );
}
