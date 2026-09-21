import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfigDetails } from "./ConfigDetails";

describe("ConfigDetails", () => {
  it("renders bounded metadata and redacted content without exposing a real path", () => {
    const markup = renderToStaticMarkup(
      <ConfigDetails
        document={{
          appId: "git",
          configId: "git-global-config",
          variantId: "primary",
          displayPath: "~/.gitconfig",
          state: "REDACTED",
          retryable: false,
          nextAction: "VIEW_REDACTED",
          format: "GIT_CONFIG",
          sensitivity: "SENSITIVE",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          entryKind: "FILE",
          sizeBytes: 24,
          mode: 0o640,
          contentHash: "a".repeat(64),
          symlink: { targetDisplayPath: "~/dotfiles/gitconfig" },
          content: "[user]\nname = Example\n[REDACTED]",
          contentRedacted: true,
        }}
      />,
    );

    expect(markup).toContain("~/.gitconfig");
    expect(markup).toContain("~/dotfiles/gitconfig");
    expect(markup).toContain("[REDACTED]");
    expect(markup).not.toContain("/Users/");
    expect(markup).not.toContain("password");
  });

  it("renders secret documents as metadata only", () => {
    const markup = renderToStaticMarkup(
      <ConfigDetails
        document={{
          appId: "npm",
          configId: "npm-user-config",
          variantId: "primary",
          displayPath: "~/.npmrc",
          state: "REDACTED",
          retryable: false,
          nextAction: "VIEW_REDACTED",
          format: "INI",
          sensitivity: "SECRET",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          entryKind: "FILE",
          sizeBytes: 18,
          contentHash: "b".repeat(64),
          contentRedacted: true,
        }}
      />,
    );

    expect(markup).toContain("仅显示元数据");
    expect(markup).not.toContain("<pre");
  });
});
