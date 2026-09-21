import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZshEditor } from "./ZshEditor";

describe("ZshEditor", () => {
  it("identifies the editor as a UserHome managed block", () => {
    const markup = renderToStaticMarkup(
      <ZshEditor
        document={{
          appId: "zsh",
          configId: "zshrc",
          variantId: "primary",
          displayPath: "~/.zshrc",
          state: "READY",
          retryable: false,
          nextAction: "NONE",
          format: "SHELL",
          sensitivity: "SENSITIVE",
          writePolicy: "MANAGED_BLOCK",
          exists: true,
          contentRedacted: false,
          structured: { aliases: [], environment: [], sources: [] },
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain("Zsh UserHome 托管块");
    expect(markup).toContain("name=value");
  });
});
