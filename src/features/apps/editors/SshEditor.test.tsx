import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshEditor } from "./SshEditor";

describe("SshEditor", () => {
  it("renders host fields without private-key controls", () => {
    const markup = renderToStaticMarkup(
      <SshEditor
        document={{
          appId: "openssh",
          configId: "ssh-client-config",
          variantId: "primary",
          displayPath: "~/.ssh/config",
          state: "READY",
          retryable: false,
          nextAction: "NONE",
          format: "SSH_CONFIG",
          sensitivity: "SENSITIVE",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          contentRedacted: false,
          structured: {},
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain('name="hostName"');
    expect(markup).not.toContain("IdentityFile");
    expect(markup).toContain("不会读取私钥");
  });
});
