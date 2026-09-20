import type { OperationSummary } from "../../ipc/operations";

const STATUS_LABELS: Record<OperationSummary["status"], string> = {
  PREVIEWED: "等待确认",
  RUNNING: "进行中",
  CANCELLING: "正在取消",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

export function OperationHistory({
  operations,
}: {
  operations: readonly OperationSummary[];
}) {
  return (
    <section className="operation-history" aria-labelledby="operation-history-heading">
      <p className="section-kicker">操作记录</p>
      <h3 id="operation-history-heading">配置历史</h3>
      {operations.length === 0 ? (
        <p>暂无配置操作。</p>
      ) : (
        <ul className="history-list">
          {operations.map((operation) => (
            <li key={operation.operationId}>
              <span>{operation.summary}</span>
              <strong>{STATUS_LABELS[operation.status]}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
