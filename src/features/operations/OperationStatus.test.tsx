import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OperationDetails } from "../../ipc/operations";
import { OperationStatus } from "./OperationStatus";

function operation(overrides: Partial<OperationDetails>): OperationDetails {
  return {
    operationId: "op-1",
    summary: "Stop fixture service",
    effects: [],
    requiresElevation: false,
    expiresAt: "2026-09-20T09:05:00Z",
    status: "RUNNING",
    events: [],
    ...overrides,
  };
}

function render(details: OperationDetails) {
  return renderToStaticMarkup(
    <OperationStatus state={{ status: "ready", operation: details }} />,
  );
}

describe("OperationStatus cancellation states", () => {
  it("shows 终止中 while the process exit is not yet confirmed", () => {
    const markup = render(operation({ status: "CANCELLING" }));

    expect(markup).toContain("终止中");
    expect(markup).toContain("确认前不会显示为已终止");
    expect(markup).not.toContain("已终止</");
  });

  it("shows 已终止 only for a cancelled operation", () => {
    const markup = render(
      operation({
        status: "CANCELLED",
        events: [
          {
            type: "finished",
            operationId: "op-1",
            sequence: 2,
            status: "CANCELLED",
          },
        ],
      }),
    );

    expect(markup).toContain("已终止");
    expect(markup).not.toContain("终止中");
    expect(markup).not.toContain("确认前不会显示为已终止");
  });

  it("shows 失败 with the unconfirmed-exit reason instead of 已终止", () => {
    const markup = render(
      operation({
        status: "FAILED",
        events: [
          {
            type: "finished",
            operationId: "op-1",
            sequence: 2,
            status: "FAILED",
            stdoutSummary: "listening",
            error: {
              code: "PROCESS_FAILED",
              message: "The process exit could not be confirmed.",
              retryable: true,
            },
          },
        ],
      }),
    );

    expect(markup).toContain("失败");
    expect(markup).toContain("The process exit could not be confirmed.");
    expect(markup).not.toContain("已终止");
    expect(markup).not.toContain("终止中");
  });

  it("tells when older events or records were dropped", () => {
    const markup = render(
      operation({ status: "SUCCEEDED", droppedEvents: 7, droppedRecords: 2 }),
    );

    expect(markup).toContain("较早的 7 条事件已被丢弃");
    expect(markup).toContain("较早的 2 条操作记录已被丢弃");
    expect(render(operation({ status: "SUCCEEDED" }))).not.toContain("已被丢弃");
  });
});
