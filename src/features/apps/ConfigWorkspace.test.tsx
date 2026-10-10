import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManagedAppSummary } from "../../ipc/catalog";
import { ConfigWorkspace } from "./ConfigWorkspace";

function application(
  overrides: Partial<ManagedAppSummary> = {},
): ManagedAppSummary {
  return {
    id: "git",
    displayName: "Git",
    description: "Git 用户级配置。",
    iconKey: "git",
    priority: "PRIORITY_A",
    coverageClass: "MANAGED_WRITABLE",
    presentation: {
      category: "开发工具",
      configDocuments: [
        {
          configId: "git-config",
          purpose: "Git 用户配置",
          pathVariants: [
            {
              variantId: "primary",
              root: "HOME",
              relativePath: "HOME/.config/git/config",
              existenceRule: "FILE",
              precedence: 0,
            },
          ],
          format: "GIT_CONFIG",
          formatFamily: "GIT_CONFIG",
          sensitivity: "SENSITIVE",
          accessMode: "READ_WRITE",
          editorKey: "git",
          maxSizeBytes: 262_144,
        },
      ],
    },
    detectionEvidence: [
      { kind: "EXECUTABLE", value: "HOME/.config/git/config" },
      { kind: "HOME_PATH", value: "HOME/.gitconfig" },
    ],
    sourceEvidence: [],
    support: {
      limitations: ["仅支持 catalog 明确授权的配置文档与操作。"],
      exclusions: ["未声明路径不获授权。"],
      requirement: "新增路径需要独立审批。",
    },
    capabilities: ["DETECT", "READ_CONFIG", "WRITE_CONFIG"],
    managedDocumentCount: 1,
    serviceCount: 0,
    ...overrides,
  };
}

function render(app: ManagedAppSummary): string {
  return renderToStaticMarkup(
    <ConfigWorkspace
      application={app}
      onSelectedConfigChange={() => undefined}
      preferredEditorMode="STRUCTURED"
    />,
  );
}

function classTokens(markup: string): string[] {
  const tokens: string[] = [];
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    for (const token of value.split(/\s+/)) {
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

function tokensForClass(markup: string, token: string): string[] {
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.includes(token)) return tokens;
  }
  throw new Error(`No element carries the class "${token}".`);
}

describe("ConfigWorkspace three-pane structure", () => {
  it("keeps identity, capability, and coverage status in the header", () => {
    const markup = render(application());

    expect(markup).toContain("Git");
    expect(markup).toContain("受管可写");
    expect(markup).toContain("读取配置");
    expect(markup).toContain("修改配置");
    const capabilities = tokensForClass(
      markup,
      "config-workspace__capabilities",
    );
    expect(capabilities).toContain("config-workspace__capabilities");
  });

  it("never collapses source and security evidence by default", () => {
    const markup = render(application());

    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).toContain("来源与证据");
    expect(markup).toContain("检测证据");
    expect(markup).toContain("官方来源证据");
    const support = tokensForClass(markup, "config-workspace__support");
    expect(support).toContain("min-w-0");
  });

  it("renders the documents list and the inspector as separate bounded panes", () => {
    const markup = render(application());

    expect(markup).toContain("配置文档");
    expect(markup).toContain("配置详情");

    const documents = tokensForClass(markup, "config-workspace__documents");
    expect(documents).toContain("min-h-0");
    expect(documents).toContain("min-w-0");

    const inspector = tokensForClass(markup, "config-workspace__inspector");
    expect(inspector).toContain("min-h-0");
    expect(inspector).toContain("min-w-0");

    expect(
      tokensForClass(markup, "config-workspace__documents-body"),
    ).toContain("overflow-y-auto");
    expect(
      tokensForClass(markup, "config-workspace__inspector-content"),
    ).toContain("overflow-y-auto");
  });

  it("keeps long paths and document names wrappable, never truncated", () => {
    const tokens = new Set(classTokens(render(application())));

    expect(tokens.has("truncate")).toBe(false);
    expect(tokens.has("text-ellipsis")).toBe(false);
    expect(tokens.has("whitespace-nowrap")).toBe(false);
  });

  it("offers no write affordances for a read-only application", () => {
    const markup = render(
      application({
        coverageClass: "MANAGED_READ_ONLY",
        capabilities: ["DETECT", "READ_CONFIG"],
      }),
    );

    expect(markup).toContain("受管只读");
    expect(markup).toContain("读取配置");
    expect(markup).not.toContain("修改配置");
    expect(markup).not.toContain("受管可写");
    expect(markup).toContain("配置文档");
    expect(markup).toContain("配置详情");
  });
});
