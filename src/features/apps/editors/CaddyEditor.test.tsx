import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaddyEditor } from "./CaddyEditor";

describe("CaddyEditor", () => {
  it("renders the allowlisted common fields", () => {
    const markup = renderToStaticMarkup(
      <CaddyEditor
        document={{
          appId: "caddy",
          configId: "caddyfile",
          displayPath: "${HOMEBREW_PREFIX}/etc/Caddyfile",
          format: "CADDYFILE",
          sensitivity: "STANDARD",
          writePolicy: "STRUCTURED_AND_RAW",
          exists: true,
          contentRedacted: false,
          structured: { siteAddress: "example.test", reverseProxy: "localhost:3000" },
        }}
        onPreview={() => undefined}
      />,
    );
    expect(markup).toContain("站点地址");
    expect(markup).toContain("localhost:3000");
  });
});
