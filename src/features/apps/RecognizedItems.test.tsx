import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManagedAppCoverageClass, ManagedAppSummary } from "../../ipc/catalog";
import type { CandidateModule } from "../../app/discoverySelectors";
import type {
  ConfigurationCoverage,
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import { RecognizedItems } from "./RecognizedItems";

type ConfigurationCoverageModule = ModuleSnapshot<ConfigurationCoverage>;

function candidateOf(
  overrides: Partial<UnmanagedCandidate> = {},
): UnmanagedCandidate {
  return {
    candidateId: "candidate-1",
    displayName: "git config",
    rootKind: "HOME",
    relativePath: "~/.config/git/config",
    entryType: "FILE",
    evidence: ["CATALOG_DOCUMENT"],
    formatHints: ["GIT_CONFIG"],
    sensitivityHint: "SENSITIVE",
    classificationReason: "Catalog owns this document.",
    catalogAppId: "git",
    name: "~/.config/git/config",
    kind: "FILE",
    coverageClass: "MANAGED_WRITABLE",
    ...overrides,
  };
}

function moduleOf(candidate: UnmanagedCandidate): ConfigurationCoverageModule {
  return {
    status: "READY",
    data: {
      completeness: "PARTIAL",
      candidates: [candidate],
      summary: {
        candidateCount: 1,
        metadataCount: 1,
        rootCount: 1,
        elapsedMs: 5,
        limits: {
          maxCandidates: 128,
          maxEntriesPerRoot: 128,
          maxMetadataCount: 512,
          maxRootDepth: 1,
          timeoutMs: 1_500,
        },
        outcomes: [],
      },
      issues: [],
    },
  };
}

function applicationOf(): ManagedAppSummary {
  return {
    id: "git",
    displayName: "Git",
    description: "Git",
    iconKey: "git",
    priority: "PRIORITY_A",
    coverageClass: "MANAGED_WRITABLE",
    presentation: {
      category: "开发工具",
      configDocuments: [
        {
          configId: "git-config",
          purpose: "Git configuration",
          pathVariants: [
            {
              variantId: "primary",
              root: "HOME",
              relativePath: ".config/git/config",
              existenceRule: "FILE",
              precedence: 0,
            },
          ],
          format: "GIT_CONFIG",
          formatFamily: "GIT_CONFIG",
          sensitivity: "SENSITIVE",
          accessMode: "READ_WRITE",
          editorKey: "git-editor",
          maxSizeBytes: 262_144,
        },
      ],
    },
    detectionEvidence: [{ kind: "HOME_PATH", value: "HOME/.gitconfig" }],
    support: {
      limitations: ["仅受管文档。"],
      exclusions: ["未声明路径不获授权。"],
      requirement: "新增路径需要审批。",
    },
    capabilities: ["DETECT", "READ_CONFIG", "WRITE_CONFIG"],
    managedDocumentCount: 1,
    serviceCount: 0,
  };
}

describe("RecognizedItems", () => {
  it("renders the fixed safe detail fields and next action", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "UNIQUE", configId: "git-config" }}
        application={applicationOf()}
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).toContain("本机识别项");
    expect(markup).toContain("安全相对路径");
    expect(markup).toContain("~/.config/git/config");
    expect(markup).toContain("分类证据");
    expect(markup).toContain("Catalog 文档匹配");
    expect(markup).toContain("覆盖等级");
    expect(markup).toContain("受管可写");
    expect(markup).toContain("分类原因");
    expect(markup).toContain("Catalog owns this document.");
    expect(markup).toContain("敏感度");
    expect(markup).toContain("敏感");
    expect(markup).toContain("扫描状态");
    expect(markup).toContain("模块状态");
    expect(markup).toContain("下一步操作");
    expect(markup).toContain("查看受管配置");
    expect(markup).toContain('data-testid="candidate-actions"');
  });

  it("reuses the managed config workspace with the matched configId when opened", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "UNIQUE", configId: "git-config" }}
        application={applicationOf()}
        module={moduleOf(candidate)}
        opened
      />,
    );

    expect(markup).toContain('data-testid="recognized-config-workspace"');
  });

  it("shows no actions for unsupported candidates", () => {
    const candidate = candidateOf({
      coverageClass: "DETECTED_UNSUPPORTED",
      catalogAppId: undefined,
    });
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "NONE" }}
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).toContain("已发现，暂不支持");
    expect(markup).not.toContain('data-testid="candidate-actions"');
    expect(markup).not.toContain("查看受管配置");
    expect(markup).not.toContain('data-testid="recognized-config-workspace"');
    expect(markup).toContain("未提供打开、写入、预览、备份、恢复、服务或提权操作");
  });

  it("shows no actions for excluded candidates", () => {
    const candidate = candidateOf({
      coverageClass: "EXCLUDED",
      catalogAppId: undefined,
    });
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "NONE" }}
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).toContain("已排除");
    expect(markup).not.toContain('data-testid="candidate-actions"');
    expect(markup).not.toContain('data-testid="recognized-config-workspace"');
  });

  it("does not guess a configId when the match is ambiguous", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "AMBIGUOUS", configIds: ["a", "b"] }}
        application={applicationOf()}
        // An application is present, but the match is ambiguous.
        opened
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).not.toContain('data-testid="candidate-actions"');
    expect(markup).not.toContain("查看受管配置");
    expect(markup).not.toContain('data-testid="recognized-config-workspace"');
    expect(markup).toContain("匹配多个受管配置文档");
  });

  it("does not guess when no document matches", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        match={{ kind: "NONE" }}
        application={applicationOf()}
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).not.toContain('data-testid="candidate-actions"');
    expect(markup).toContain("未唯一匹配受管配置文档");
  });

  it("explains a managed match loading state without offering actions", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        module={moduleOf(candidate)}
      />,
    );

    expect(markup).toContain("正在匹配受管配置文档");
    expect(markup).not.toContain('data-testid="candidate-actions"');
  });

  it("surfaces module error state and match errors without actions", () => {
    const candidate = candidateOf();
    const markup = renderToStaticMarkup(
      <RecognizedItems
        candidate={candidate}
        matchError={{
          code: "INTERNAL",
          message: "无法加载受管应用。",
          retryable: false,
        }}
        module={{ status: "ERROR", error: { module: "candidates", message: "候选扫描失败。", retryable: true } }}
      />,
    );

    expect(markup).toContain("候选扫描失败。");
    expect(markup).toContain("无法加载受管应用。");
    expect(markup).not.toContain('data-testid="candidate-actions"');
  });
});

// The component accepts either the legacy array module or the full
// ConfigurationCoverage module; both must satisfy the shared union type.
const _moduleTypeCheck: CandidateModule = { status: "READY", data: [] };
void _moduleTypeCheck;
const _coverageClassCheck: ManagedAppCoverageClass = "EXCLUDED";
void _coverageClassCheck;
