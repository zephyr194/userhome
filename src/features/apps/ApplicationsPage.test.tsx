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
