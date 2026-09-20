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
    capabilities: ["DETECT", "READ_CONFIG"] as const,
    managedDocumentCount: Number(managedDocumentCount),
    serviceCount: Number(serviceCount),
  })),
};

describe("ApplicationsPage", () => {
  it("renders all six approved definitions as a read-only list", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        candidates={{ status: "READY", data: [] }}
        state={{ status: "ready", catalog }}
      />,
    );

    expect(markup.match(/class="application-card"/g)).toHaveLength(6);
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
    expect(markup).toContain("受管文档 4 项");
    expect(markup).toContain("用户级服务 1 项");
    expect(markup).not.toContain("~");
    expect(markup).not.toContain("pathTemplate");
    expect(markup).toContain("仅可通过内置 catalog");
    expect(markup).toContain("安全配置");
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
