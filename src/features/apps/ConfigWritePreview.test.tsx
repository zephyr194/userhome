import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfigWritePreview } from "./ConfigWritePreview";

describe("ConfigWritePreview", () => {
  it("renders a redacted diff and explicit confirmation action", () => {
    const markup = renderToStaticMarkup(
      <ConfigWritePreview
        preview={{
          operationId: "operation-1",
          summary: "Update git configuration.",
          effects: ["Create a protected backup."],
          requiresElevation: false,
          expiresAt: "2026-09-20T10:00:00Z",
          currentHash: "a".repeat(64),
          proposedHash: "b".repeat(64),
          diff: {
            redacted: true,
            truncated: false,
            lines: [{ kind: "ADDED", text: "[REDACTED]" }],
          },
        }}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain("敏感内容已从差异中隐藏");
    expect(markup).toContain("[REDACTED]");
    expect(markup).toContain("确认并写入");
    expect(markup).toContain('role="dialog"');
    expect(markup).not.toContain("token=");
  });
});
