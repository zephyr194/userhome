import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationsPage } from "./ApplicationsPage";

const catalog = {
  schemaVersion: 1 as const,
  applications: [
    ["github-copilot", "GitHub Copilot", 4, 0],
    ["caddy", "Caddy", 1, 1],
    ["git", "Git", 1, 0],
    ["openssh", "OpenSSH", 1, 0],
    ["zsh", "Zsh", 1, 0],
    ["npm", "npm", 1, 0],
  ].map(([id, displayName, managedDocumentCount, serviceCount]) => ({
    id: String(id),
    displayName: String(displayName),
    description: `${displayName} description`,
    iconKey: String(id),
    coverageClass: "MANAGED_WRITABLE" as const,
    presentation: {
      category: "开发工具",
      configDocuments: Array.from(
        { length: Number(managedDocumentCount) },
        (_, index) => ({
          configId: `${id}-config-${index}`,
          purpose: `${displayName} configuration`,
          pathVariants: [
            {
              variantId: "primary",
              root: "HOME" as const,
              relativePath: `.config/${id}/config`,
              existenceRule: "FILE" as const,
              precedence: 0,
            },
          ],
          format: "JSON" as const,
          formatFamily: "JSON" as const,
          sensitivity: "SENSITIVE" as const,
          accessMode: "READ_WRITE" as const,
          editorKey: `${id}-editor`,
          maxSizeBytes: 262_144,
        }),
      ),
    },
    capabilities: ["DETECT", "READ_CONFIG", "WRITE_CONFIG"] as const,
    managedDocumentCount: Number(managedDocumentCount),
    serviceCount: Number(serviceCount),
  })),
};

describe("ApplicationsPage", () => {
  it("renders all six approved definitions in the catalog workspace", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        candidates={{ status: "READY", data: [] }}
        state={{ status: "ready", catalog }}
      />,
    );

    for (const name of [
      "GitHub Copilot",
      "Caddy",
      "Git",
      "OpenSSH",
      "Zsh",
      "npm",
    ]) {
      expect(markup).toContain(name);
    }
    expect(markup).toContain('aria-label="应用与配置候选列表"');
    expect(markup).toContain("受管可写");
    expect(markup).toContain("4 个配置定义");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("~");
    expect(markup).not.toContain("pathTemplate");
    expect(markup).toContain("覆盖与授权");
  });

  it("renders explicit loading and error states", () => {
    const loading = renderToStaticMarkup(
      <ApplicationsPage
        candidates={{ status: "LOADING" }}
        state={{ status: "loading" }}
      />,
    );
    const failed = renderToStaticMarkup(
      <ApplicationsPage
        candidates={{ status: "LOADING" }}
        state={{
          status: "error",
          error: {
            code: "INTERNAL",
            message: "无法加载应用目录。",
            retryable: false,
          },
        }}
      />,
    );

    expect(loading).toContain('aria-busy="true"');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("无法加载应用目录。");
  });
});
