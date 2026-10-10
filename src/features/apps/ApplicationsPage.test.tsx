import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SanitizedBaselineManifest, UnmanagedCandidate } from "../../ipc/discovery";
import { ApplicationsPage } from "./ApplicationsPage";
import { summarizeCatalogCoverage } from "./catalogCoverage";

const catalog = {
  schemaVersion: 1 as const,
  coveragePolicy: {
    priorityATotal: 6,
    priorityAUsable: 6,
    priorityBTotal: 20,
    priorityBCovered: 20,
    minimumEligibleTextPercent: 90,
  },
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
    priority: "PRIORITY_A" as const,
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
    detectionEvidence: [
      {
        kind: "HOME_PATH" as const,
        value: `HOME/.config/${id}/config`,
      },
    ],
    support: {
      limitations: ["仅支持 catalog 明确授权的配置文档与操作。"],
      exclusions: ["未声明路径不获授权。"],
      requirement: "新增路径需要独立审批。",
    },
    capabilities: ["DETECT", "READ_CONFIG", "WRITE_CONFIG"] as const,
    managedDocumentCount: Number(managedDocumentCount),
    serviceCount: Number(serviceCount),
  })),
};

function recognizedCandidate(
  candidateId: string,
  coverageClass: UnmanagedCandidate["coverageClass"],
  relativePath: string,
): UnmanagedCandidate {
  return {
    candidateId,
    displayName: `${candidateId} display`,
    rootKind: "HOME",
    relativePath,
    entryType: "FILE",
    evidence: ["BOUNDED_ROOT_ENTRY"],
    formatHints: ["JSON"],
    sensitivityHint: "SENSITIVE",
    classificationReason: `${candidateId} classification reason`,
    name: relativePath,
    kind: "FILE",
    coverageClass,
  };
}

const recognized: readonly UnmanagedCandidate[] = [
  recognizedCandidate("writable", "MANAGED_WRITABLE", "~/.config/git/config"),
  recognizedCandidate("readonly", "MANAGED_READ_ONLY", "~/.config/zsh/zshrc"),
  recognizedCandidate("unsupported", "DETECTED_UNSUPPORTED", "~/.config/tool/config.toml"),
  recognizedCandidate("excluded", "EXCLUDED", "~/.ssh/secret"),
];

describe("ApplicationsPage", () => {
  it("renders all six approved definitions in the catalog workspace", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="CATALOG"
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
    expect(markup).toContain("覆盖与授权");
    expect(markup).toContain("支持范围说明");
    expect(markup).toContain("Priority A");
    expect(markup).toContain("开发工具 · 6");
    expect(markup).toContain('aria-label="Catalog 分页"');
  });

  it("switches between the local recognized list and the full catalog with counts", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        candidates={{ status: "READY", data: recognized }}
        state={{ status: "ready", catalog }}
      />,
    );

    expect(markup).toContain('role="tab"');
    expect(markup).toContain("本机识别 · 4");
    expect(markup).toContain("全部目录 · 6");
  });

  it("lists all four recognized coverage classes under one local label", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="LOCAL_RECOGNIZED"
        candidates={{ status: "READY", data: recognized }}
        state={{ status: "ready", catalog }}
      />,
    );

    expect(markup).toContain("本机识别项");
    expect(markup).toContain("受管可写");
    expect(markup).toContain("受管只读");
    expect(markup).toContain("已发现，暂不支持");
    expect(markup).toContain("已排除");
    // The local scope must not filter by the system detected ids nor render the
    // managed catalog rows.
    expect(markup).not.toContain("GitHub Copilot");
  });

  it("renders the safe detail fields for the selected recognized item", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="LOCAL_RECOGNIZED"
        candidates={{ status: "READY", data: recognized }}
        state={{ status: "ready", catalog }}
      />,
    );

    expect(markup).toContain("安全相对路径");
    expect(markup).toContain("~/.config/git/config");
    expect(markup).toContain("分类证据");
    expect(markup).toContain("分类原因");
    expect(markup).toContain("敏感度");
    expect(markup).toContain("扫描状态");
    expect(markup).toContain("模块状态");
    expect(markup).toContain("下一步操作");
  });

  it("never offers actions for unsupported or excluded recognized items", () => {
    for (const candidateId of ["unsupported", "excluded"]) {
      const markup = renderToStaticMarkup(
        <ApplicationsPage
          applicationsScope="LOCAL_RECOGNIZED"
          candidates={{
            status: "READY",
            data: recognized.filter((candidate) => candidate.candidateId === candidateId),
          }}
          state={{ status: "ready", catalog }}
        />,
      );

      expect(markup).not.toContain('data-testid="candidate-actions"');
      expect(markup).not.toContain("查看受管配置");
      expect(markup).not.toContain('data-testid="recognized-config-workspace"');
    }
  });

  it("explains a stale selection without producing a ghost selection", () => {
    const markup = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="LOCAL_RECOGNIZED"
        candidateId="vanished"
        candidates={{ status: "READY", data: [recognized[0]] }}
        staleReason="CANDIDATE_MISSING"
        state={{ status: "ready", catalog }}
      />,
    );

    expect(markup).toContain("data-testid=\"stale-selection-notice\"");
    expect(markup).toContain("幽灵选择");
    // The vanished candidate must not be rendered as a selection detail.
    expect(markup).not.toContain("vanished display");
  });

  it("reconciles classified and eligible text coverage from the sanitized manifest", () => {
    const manifest: SanitizedBaselineManifest = {
      schemaVersion: 1,
      completeness: "PARTIAL",
      coverage: {
        totalCandidateCount: 5,
        managedCandidateCount: 3,
        managedWritableCount: 1,
        managedReadOnlyCount: 2,
        unsupportedCount: 1,
        excludedCount: 1,
        exportedCandidateCount: 4,
        omittedCandidateCount: 1,
        eligibleTextCount: 3,
        managedEligibleTextCount: 2,
      },
      scan: {
        candidateCount: 5,
        metadataCount: 5,
        rootCount: 2,
        elapsedMs: 1,
        limits: {
          maxCandidates: 128,
          maxEntriesPerRoot: 128,
          maxMetadataCount: 512,
          maxRootDepth: 1,
          timeoutMs: 1_500,
        },
        outcomes: ["CANDIDATE_LIMIT_REACHED"],
      },
      candidates: [
        {
          candidateId: "candidate-1",
          rootKind: "HOME",
          relativePath: "HOME/.gitconfig",
          entryType: "FILE",
          evidence: ["CATALOG_DOCUMENT"],
          formatHints: ["GIT_CONFIG"],
          sensitivityHint: "SENSITIVE",
          coverageClass: "MANAGED_WRITABLE",
          classificationReason: "Managed.",
          catalogAppId: "git",
        },
        {
          candidateId: "candidate-2",
          rootKind: "XDG_CONFIG_HOME",
          relativePath: "XDG_CONFIG_HOME/tool/config.toml",
          entryType: "FILE",
          evidence: ["BOUNDED_ROOT_ENTRY"],
          formatHints: ["TOML"],
          sensitivityHint: "UNKNOWN",
          coverageClass: "DETECTED_UNSUPPORTED",
          classificationReason: "Unsupported.",
        },
        {
          candidateId: "candidate-3",
          rootKind: "APPLICATION_SUPPORT",
          relativePath: "APPLICATION_SUPPORT/App",
          entryType: "DIRECTORY",
          evidence: ["BOUNDED_ROOT_ENTRY"],
          formatHints: [],
          sensitivityHint: "UNKNOWN",
          coverageClass: "DETECTED_UNSUPPORTED",
          classificationReason: "Unsupported.",
        },
        {
          candidateId: "candidate-4",
          rootKind: "HOME",
          relativePath: "HOME/settings.json",
          entryType: "FILE",
          evidence: ["CATALOG_DOCUMENT"],
          formatHints: ["JSON"],
          sensitivityHint: "SENSITIVE",
          coverageClass: "MANAGED_READ_ONLY",
          classificationReason: "Managed.",
          catalogAppId: "visual-studio-code",
        },
      ],
    };

    const metrics = summarizeCatalogCoverage(catalog, manifest);

    expect(metrics.classifiedCandidateCount).toBe(5);
    expect(metrics.eligibleTextCount).toBe(3);
    expect(metrics.managedEligibleTextCount).toBe(2);
    expect(metrics.eligibleTextPercent).toBeCloseTo(66.7, 1);
    expect(metrics.meetsEligibleTextTarget).toBe(false);
    expect(metrics.priorityAComplete).toBe(true);
    expect(metrics.priorityBComplete).toBe(true);
    expect(metrics.complete).toBe(false);
  });

  it("renders explicit loading and error states", () => {
    const loading = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="LOCAL_RECOGNIZED"
        candidates={{ status: "LOADING" }}
        state={{ status: "loading" }}
      />,
    );
    const failed = renderToStaticMarkup(
      <ApplicationsPage
        applicationsScope="CATALOG"
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

function classTokens(markup: string): string[] {
  const tokens: string[] = [];
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    for (const token of value.split(/\s+/)) {
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

/** First element that carries `token` as an exact class. */
function tokensForClass(markup: string, token: string): string[] {
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.includes(token)) return tokens;
  }
  throw new Error(`No element carries the class "${token}".`);
}

function renderCatalog(): string {
  return renderToStaticMarkup(
    <ApplicationsPage
      applicationsScope="CATALOG"
      candidates={{ status: "READY", data: [] }}
      state={{ status: "ready", catalog }}
    />,
  );
}

function renderLocal(): string {
  return renderToStaticMarkup(
    <ApplicationsPage
      applicationsScope="LOCAL_RECOGNIZED"
      candidates={{ status: "READY", data: recognized }}
      state={{ status: "ready", catalog }}
    />,
  );
}

describe("ApplicationsPage three-pane structure", () => {
  it("drops the duplicate page heading and the whole-page card shell", () => {
    const markup = renderCatalog();

    // AppShell owns the page title; the workspace must not repeat an h2 hero.
    expect(markup).not.toContain("<h2");
    expect(markup).not.toContain("section-kicker");
    expect(markup).not.toContain('class="applications-workspace"');

    const root = tokensForClass(markup, "applications-workspace__frame");
    expect(root).toContain("min-h-0");
    expect(root).toContain("min-w-0");
    expect(root).toContain("overflow-hidden");
    expect(root).not.toContain("rounded-panel");
    expect(root).not.toContain("border-border");
  });

  it("keeps scope and filters as the pane header without a page title", () => {
    const markup = renderCatalog();

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="应用筛选"');
    expect(markup).toContain('id="applications-heading"');
    const header = tokensForClass(markup, "applications-workspace__header");
    expect(header).toContain("min-w-0");
  });

  it("pins catalog pagination in the list footer, outside the scrolling body", () => {
    const markup = renderCatalog();

    const body = tokensForClass(markup, "applications-workspace__list-body");
    expect(body).toContain("overflow-y-auto");
    expect(body).toContain("min-h-0");

    const footer = tokensForClass(markup, "applications-workspace__list-footer");
    expect(footer).toContain("shrink-0");
    expect(footer).not.toContain("overflow-y-auto");
    expect(markup).toContain('aria-label="Catalog 分页"');

    const bodyStart = markup.indexOf("applications-workspace__list-body");
    const footerStart = markup.indexOf("applications-workspace__list-footer");
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    expect(footerStart).toBeGreaterThan(bodyStart);
    expect(markup.slice(bodyStart, footerStart)).not.toContain("Catalog 分页");
  });

  it("gives the local list and detail their own bounded panes", () => {
    const markup = renderLocal();

    expect(markup).toContain('aria-label="本机识别项列表"');
    const pane = tokensForClass(markup, "applications-workspace__list-pane");
    expect(pane).toContain("min-h-0");
    expect(pane).toContain("min-w-0");
    expect(pane).toContain("overflow-hidden");
    expect(pane).toContain("flex");

    expect(tokensForClass(markup, "applications-workspace__list-body")).toContain(
      "overflow-y-auto",
    );

    const detail = tokensForClass(markup, "applications-workspace__detail");
    expect(detail).toContain("min-h-0");
    expect(detail).toContain("min-w-0");
    expect(detail).toContain("overflow-hidden");
  });

  it("bounds the workspace body and detail as independent scroll owners", () => {
    const markup = renderCatalog();

    const body = tokensForClass(markup, "applications-workspace__body");
    expect(body).toContain("min-h-0");
    expect(body).toContain("min-w-0");
    expect(body).toContain("overflow-hidden");

    expect(tokensForClass(markup, "applications-workspace__detail")).toContain(
      "overflow-hidden",
    );
  });

  it("never truncates names, paths, or errors", () => {
    for (const markup of [renderCatalog(), renderLocal()]) {
      const tokens = new Set(classTokens(markup));
      expect(tokens.has("truncate")).toBe(false);
      expect(tokens.has("text-ellipsis")).toBe(false);
      expect(tokens.has("whitespace-nowrap")).toBe(false);
    }
  });
});
