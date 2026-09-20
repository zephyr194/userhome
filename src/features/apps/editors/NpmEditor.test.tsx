import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NpmEditor } from "./NpmEditor";

describe("NpmEditor", () => {
  it("uses an empty write-only secret field", () => {
    const markup = renderToStaticMarkup(
      <NpmEditor
        document={{
          appId: "npm",
          configId: "npm-user-config",
          displayPath: "~/.npmrc",
          format: "INI",
          sensitivity: "SECRET",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          contentRedacted: true,
          structured: { registry: "https://registry.npmjs.org/", hasAuthToken: true },
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain("原值不可读取");
    expect(markup).not.toContain("fixture-secret");
  });
});
