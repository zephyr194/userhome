import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationHistory } from "./OperationHistory";

describe("OperationHistory", () => {
  it("renders only sanitized operation summaries and statuses", () => {
    const markup = renderToStaticMarkup(
      <OperationHistory
        operations={[
          {
            operationId: "operation-1",
            summary: "Update npm configuration npm-user-config.",
            status: "SUCCEEDED",
          },
        ]}
      />,
    );

    expect(markup).toContain("Update npm configuration npm-user-config.");
    expect(markup).toContain("已完成");
    expect(markup).not.toContain("secret-value");
    expect(markup).not.toContain("content");
  });
});
