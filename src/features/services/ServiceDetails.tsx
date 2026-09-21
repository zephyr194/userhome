import {
  Button,
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
    <section
      className="service-details-pane"
      aria-labelledby="service-details-heading"
    >
      <header className="service-details-pane__header">
        <div className="min-w-0">
          <h3 id="service-details-heading">{details.displayName}</h3>
          <p>{details.serviceId}</p>
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
      </header>

      <dl className="service-details-pane__metadata">
        <div>
          <dt>作用域</dt>
          <dd className="mt-1 font-medium">{SCOPE_LABELS[details.scope]}</dd>
        </div>
        <div>
          <dt>软件版本</dt>
          <dd className="mt-1 font-medium">
            {details.packageVersion ?? "未知"}
          </dd>
        </div>
        <div>
          <dt>Caddyfile</dt>
          <dd className="mt-1">
            <StatusBadge tone={VALIDITY_TONES[details.configValidity]}>
              {VALIDITY_LABELS[details.configValidity]}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>运行身份</dt>
          <dd className="mt-1 font-medium">{details.user ?? "不可用"}</dd>
        </div>
      </dl>

      {details.configIssue ? (
        <p
          className="service-details-pane__warning"
          role="status"
        >
          {details.configIssue}
        </p>
      ) : null}

      {details.manageable ? (
        <div
          className="service-details-pane__actions"
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
        <div className="service-details-pane__readonly">
          <p className="text-sm text-muted-foreground">
            此服务仅供查看，不提供启动、停止或重启操作。
          </p>
        </div>
      )}
    </section>
  );
}
