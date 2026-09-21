import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopilotEditor } from "./CopilotEditor";

describe("CopilotEditor", () => {
  it("renders only approved structured settings", () => {
    const markup = renderToStaticMarkup(
      <CopilotEditor
        document={{
          appId: "github-copilot",
          configId: "copilot-settings",
          variantId: "primary",
          displayPath: "~/.copilot/settings.json",
          state: "READY",
          retryable: false,
          nextAction: "NONE",
          format: "JSON",
          sensitivity: "SENSITIVE",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          contentRedacted: false,
          structured: { model: "auto", futureKey: "preserved by Rust" },
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain("Copilot 安全设置");
    expect(markup).toContain('name="model"');
    expect(markup).not.toContain("futureKey");
  });
});
