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

export function ServiceDetails({
  details,
  onAction,
}: {
  details: ServiceDetailsValue;
  onAction: (action: ServiceAction) => void;
}) {
  return (
    <section className="service-details" aria-labelledby="service-details-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">服务详情</p>
          <h3 id="service-details-heading">{details.displayName}</h3>
        </div>
        <span className="state-label">{STATE_LABELS[details.state]}</span>
      </div>
      <dl className="package-metadata">
        <div>
          <dt>作用域</dt>
          <dd>{details.scope}</dd>
        </div>
        <div>
          <dt>软件版本</dt>
          <dd>{details.packageVersion ?? "未知"}</dd>
        </div>
        <div>
          <dt>Caddyfile</dt>
          <dd>{VALIDITY_LABELS[details.configValidity]}</dd>
        </div>
      </dl>
      {details.configIssue ? <p>{details.configIssue}</p> : null}
      {details.manageable ? (
        <div className="dialog-actions" aria-label="Caddy 用户级服务操作">
          <button
            className="secondary-button"
            type="button"
            onClick={() => onAction("START")}
          >
            启动
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onAction("STOP")}
          >
            停止
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={details.configValidity !== "VALID"}
            onClick={() => onAction("RESTART")}
          >
            重启
          </button>
        </div>
      ) : (
        <p className="panel-note">此服务仅供查看，不提供变更操作。</p>
      )}
    </section>
  );
}
