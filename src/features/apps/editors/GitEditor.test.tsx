import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GitEditor } from "./GitEditor";

describe("GitEditor", () => {
  it("does not expose credential fields", () => {
    const markup = renderToStaticMarkup(
      <GitEditor
        document={{
          appId: "git",
          configId: "git-global-config",
          displayPath: "~/.gitconfig",
          format: "GIT_CONFIG",
          sensitivity: "SENSITIVE",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          contentRedacted: true,
          structured: { userName: "Example", userEmail: "e@example.test" },
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain("credential 与 include 设置不会被结构化编辑修改");
    expect(markup).not.toContain('name="credential');
  });
});
