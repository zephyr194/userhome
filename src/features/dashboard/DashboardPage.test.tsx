import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { selectCandidateCoverage } from "../../app/discoverySelectors";
import type {
  ConfigurationCoverage,
  DiscoverySnapshot,
  ManagedAppDetection,
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import { decodeDiscoverySnapshot } from "../../ipc/discovery";
import type { OptionalDiscoveryRoot } from "../../ipc/settings";
import {
  MAX_COVERAGE_ACTIONS,
  DashboardPage,
  localCoveragePlan,
} from "./DashboardPage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function detectedApplication(appId: string): ManagedAppDetection {
  return { appId, displayName: appId, status: "DETECTED", evidence: [] };
}

function candidate(
  candidateId: string,
  coverageClass: UnmanagedCandidate["coverageClass"],
  overrides: Partial<UnmanagedCandidate> = {},
): UnmanagedCandidate {
  return {
    candidateId,
    displayName: candidateId,
    rootKind: "HOME",
    relativePath: `~/${candidateId}`,
    entryType: "FILE",
    evidence: ["BOUNDED_ROOT_ENTRY"],
    formatHints: [],
    sensitivityHint: "UNKNOWN",
    classificationReason: "Bounded metadata discovery.",
    name: candidateId,
    kind: "FILE",
    coverageClass,
    ...overrides,
  };
}

function coverage(
  candidates: readonly UnmanagedCandidate[],
  overrides: Partial<ConfigurationCoverage> = {},
): ConfigurationCoverage {
  return {
    completeness: "COMPLETE",
    candidates,
    summary: {
      candidateCount: candidates.length,
      metadataCount: candidates.length,
      rootCount: 1,
      elapsedMs: 5,
      limits: {
        maxCandidates: 128,
        maxEntriesPerRoot: 64,
        maxMetadataCount: 512,
        maxRootDepth: 1,
        timeoutMs: 1500,
      },
      outcomes: [],
    },
    issues: [],
    ...overrides,
  };
}

function readyModule<T>(data: T): ModuleSnapshot<T> {
  return { status: "READY", data };
}

function readySnapshot(
  candidatesModule: ModuleSnapshot<ConfigurationCoverage>,
  overrides: Partial<DiscoverySnapshot> = {},
): DiscoverySnapshot {
  return {
    refreshId: "refresh-1",
    startedAtEpochMs: 1,
    system: {
      status: "READY",
      data: {
        completeness: "COMPLETE",
        osVersion: "15.0",
        architecture: "arm64",
        homeDirectory: "~",
        applications: [detectedApplication("git")],
        issues: [],
      },
    },
    brew: { status: "LOADING" },
    candidates: candidatesModule,
    ...overrides,
  };
}

const FOUR_CLASS_COVERAGE = coverage([
  candidate("git-config", "MANAGED_WRITABLE", {
    displayName: "Git 配置",
    relativePath: "~/.gitconfig",
    evidence: ["CATALOG_DOCUMENT"],
  }),
  candidate("zsh-rc", "MANAGED_READ_ONLY", {
    displayName: "Zsh 配置",
    relativePath: "~/.zshrc",
    evidence: ["CATALOG_DOCUMENT"],
  }),
  candidate("editor", "DETECTED_UNSUPPORTED", {
    displayName: "编辑器设置",
    relativePath: "~/.editorconfig",
    evidence: ["METADATA_PRESENT"],
  }),
  candidate("secret", "EXCLUDED", {
    displayName: "排除项",
    relativePath: "~/.ssh",
    evidence: ["EXCLUSION_RULE"],
  }),
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardPage user-directory configuration group", () => {
  it("renders the user-directory configuration group as the first dashboard group", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }}
      />,
    );

    const order = ["用户目录配置", "系统脉冲", "关注事项", "软件与服务", "最近活动"].map(
      (label) => markup.indexOf(label),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("counts the four coverage classes from one refresh and preserves the total", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }}
      />,
    );

    expect(markup).toContain('aria-label="用户目录覆盖计数"');
    expect(markup).toMatch(/<dt>总数<\/dt><dd>4<\/dd>/);
    expect(markup).toMatch(/<dt>受管可写<\/dt><dd>1<\/dd>/);
    expect(markup).toMatch(/<dt>受管只读<\/dt><dd>1<\/dd>/);
    expect(markup).toMatch(/<dt>已发现，暂不支持<\/dt><dd>1<\/dd>/);
    expect(markup).toMatch(/<dt>已排除<\/dt><dd>1<\/dd>/);
    expect(markup).toContain("四类计数守恒");
    expect(markup).toContain("共 4 项");
  });

  it("shows safe paths, evidence, coverage labels, and a bounded prioritized action list", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }}
      />,
    );

    // Managed candidates are surfaced before unsupported/excluded ones.
    expect(markup).toContain("~/.gitconfig");
    expect(markup).toContain("~/.zshrc");
    expect(markup).toContain("~/.editorconfig");
    // The lowest-priority excluded row is bounded out but the remainder is noted.
    expect(markup).not.toContain("~/.ssh");
    expect(markup).toContain(`另有 1 项`);
    expect(markup).toContain("Catalog 文档匹配");
    expect(markup).toContain("受管可写");
  });

  it("does not render final zero counts while discovery is loading", () => {
    const loading = renderToStaticMarkup(<DashboardPage state={{ status: "loading" }} />);
    expect(loading).toContain("正在读取用户目录配置");
    expect(loading).not.toContain('aria-label="用户目录覆盖计数"');
    expect(loading).not.toContain("四类计数守恒");
    expect(loading).not.toContain("未发现用户目录配置");

    const pending = renderToStaticMarkup(
      <DashboardPage
        state={{
          status: "ready",
          snapshot: readySnapshot({ status: "LOADING" }),
        }}
      />,
    );
    expect(pending).toContain("正在读取用户目录配置");
    expect(pending).not.toContain('aria-label="用户目录覆盖计数"');
  });

  it("renders a complete empty state without inventing rows", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{
          status: "ready",
          snapshot: readySnapshot(readyModule(coverage([]))),
        }}
      />,
    );

    expect(markup).toContain("未发现用户目录配置");
    expect(markup).toContain('aria-label="用户目录覆盖计数"');
    expect(markup).toMatch(/<dt>总数<\/dt><dd>0<\/dd>/);
    expect(markup).toContain("共 0 项");
    expect(markup).not.toContain("本机识别行动项");
  });

  it("keeps rows and reasons when the scan is partial and restricted", () => {
    const restricted = coverage(
      [
        candidate("git-config", "MANAGED_WRITABLE", {
          relativePath: "~/.gitconfig",
          evidence: ["CATALOG_DOCUMENT"],
        }),
      ],
      {
        completeness: "PARTIAL",
        issues: [
          { module: "candidates", message: "有 1 个根目录不可读。", retryable: true },
        ],
        summary: {
          ...coverage([]).summary,
          candidateCount: 1,
          metadataCount: 1,
          outcomes: [
            { kind: "PERMISSION_DENIED", message: "没有权限读取 ~/Library。", retryable: false },
            { kind: "CANDIDATE_LIMIT_REACHED", message: "达到候选数量上限。", retryable: true },
          ],
        },
      },
    );

    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{ status: "ready", snapshot: readySnapshot(readyModule(restricted)) }}
      />,
    );

    // Rows survive a restricted scan.
    expect(markup).toContain("~/.gitconfig");
    expect(markup).toMatch(/<dt>总数<\/dt><dd>1<\/dd>/);
    // Partial + restricted are distinguishable and reasons are not hidden.
    expect(markup).toContain("部分可用");
    expect(markup).toContain("受限");
    expect(markup).toContain("没有权限读取 ~/Library。");
    expect(markup).toContain("达到候选数量上限。");
    expect(markup).toContain("有 1 个根目录不可读。");
  });

  it("labels a complete scan that still hit a restricting outcome", () => {
    const restricted = coverage([candidate("git-config", "MANAGED_WRITABLE")], {
      completeness: "COMPLETE",
      summary: {
        ...coverage([]).summary,
        candidateCount: 1,
        metadataCount: 1,
        outcomes: [
          { kind: "TIMEOUT", message: "读取某个根目录超时。", retryable: true },
        ],
      },
    });

    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{ status: "ready", snapshot: readySnapshot(readyModule(restricted)) }}
      />,
    );

    expect(markup).toContain("受限");
    expect(markup).toContain("读取某个根目录超时。");
    expect(markup).toContain("~/git-config");
  });

  it("surfaces a module-level candidates error instead of fake counts", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{
          status: "ready",
          snapshot: readySnapshot({
            status: "ERROR",
            error: { module: "candidates", message: "候选扫描失败。", retryable: true },
          }),
        }}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("候选扫描失败。");
    expect(markup).not.toContain('aria-label="用户目录覆盖计数"');
  });

  it("does not invent stale counts when a top-level error has no previous snapshot", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{
          status: "error",
          error: { code: "INTERNAL", message: "初次刷新失败。", retryable: true },
        }}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("初次刷新失败。");
    expect(markup).not.toContain('aria-label="用户目录覆盖计数"');
    expect(markup).not.toContain("刷新失败：");
  });

  it("keeps the previous snapshot and names the refresh failure on a top-level error", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        state={{
          status: "error",
          error: { code: "INTERNAL", message: "后端不可达。", retryable: true },
          previousSnapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)),
        }}
      />,
    );

    expect(markup).toContain("刷新失败");
    expect(markup).toContain("后端不可达。");
    expect(markup).toContain("上次");
    // Old results are retained rather than cleared.
    expect(markup).toContain("~/.gitconfig");
    expect(markup).toMatch(/<dt>总数<\/dt><dd>4<\/dd>/);
  });

  it("distinguishes disabled optional discovery roots from a restricted scan", () => {
    const disabled: readonly OptionalDiscoveryRoot[] = ["HOME"];
    const withDisabled = renderToStaticMarkup(
      <DashboardPage
        optionalDiscoveryRoots={disabled}
        state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }}
      />,
    );
    expect(withDisabled).toContain("已停用");
    expect(withDisabled).toContain("XDG_CONFIG_HOME/");

    const allEnabled: readonly OptionalDiscoveryRoot[] = [
      "HOME",
      "XDG_CONFIG_HOME",
      "APPLICATION_SUPPORT",
      "HOMEBREW_PREFIX",
    ];
    const enabled = renderToStaticMarkup(
      <DashboardPage
        optionalDiscoveryRoots={allEnabled}
        state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }}
      />,
    );
    expect(enabled).not.toContain("已停用");
  });

  it("never presents catalog or machine totals as the locally recognized count", () => {
    const snapshot = readySnapshot(readyModule(coverage([candidate("a", "MANAGED_WRITABLE")])), {
      system: {
        status: "READY",
        data: {
          completeness: "COMPLETE",
          osVersion: "15.0",
          architecture: "arm64",
          homeDirectory: "~",
          applications: [
            detectedApplication("git"),
            detectedApplication("npm"),
            detectedApplication("zsh"),
          ],
          issues: [],
        },
      },
    });

    const markup = renderToStaticMarkup(
      <DashboardPage state={{ status: "ready", snapshot }} />,
    );

    expect(markup).not.toContain("应用目录");
    expect(markup).toMatch(/<dt>总数<\/dt><dd>1<\/dd>/);
  });

  it("keeps the machine summary and evidence after the first group", () => {
    const snapshot = readySnapshot(readyModule(FOUR_CLASS_COVERAGE), {
      system: {
        status: "READY",
        data: {
          completeness: "PARTIAL",
          osVersion: "15.0",
          architecture: "arm64",
          homeDirectory: "~",
          shell: "PATH/zsh",
          applications: [detectedApplication("git")],
          issues: [{ module: "shell", message: "Login shell is unavailable.", retryable: false }],
        },
      },
    });

    const markup = renderToStaticMarkup(
      <DashboardPage state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("15.0");
    expect(markup).toContain("arm64");
    expect(markup).toContain("已识别应用");
    expect(markup).toContain("部分结果");
    expect(markup).toContain("正在后台读取软件清单");
    expect(markup).toContain("Login shell is unavailable.");
    expect(markup.indexOf("用户目录配置")).toBeLessThan(markup.indexOf("已识别应用"));
  });
});

describe("DashboardPage retired navigation targets", () => {
  function navigatingMarkup(state: Parameters<typeof DashboardPage>[0]["state"]) {
    return renderToStaticMarkup(<DashboardPage state={state} />);
  }

  it("renders no control that leads to the retired applications or software pages", () => {
    const markup = navigatingMarkup({
      status: "ready",
      snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)),
    });

    expect(markup).not.toContain("在本机识别中查看");
    expect(markup).not.toContain("查看全部");
    // The only remaining "查看" entry is the services shortcut.
    expect(markup.match(/查看/g) ?? []).toHaveLength(1);
    expect(markup).toMatch(/<span>服务<\/span><button[^>]*>查看<\/button>/);
  });

  it("does not attach a retired navigation target to attention items", () => {
    const markup = navigatingMarkup({
      status: "ready",
      snapshot: readySnapshot(
        { status: "ERROR", error: { module: "candidates", message: "候选扫描失败。", retryable: true } },
        {
          brew: {
            status: "ERROR",
            error: { module: "brew", message: "Homebrew 读取失败。", retryable: true },
          },
        },
      ),
    });

    expect(markup).toContain("配置发现异常");
    expect(markup).toContain("Homebrew异常");
    expect(markup.match(/查看/g) ?? []).toHaveLength(1);
  });

  it("keeps the service overview and basic status", () => {
    const markup = navigatingMarkup({
      status: "ready",
      snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)),
    });

    expect(markup).toContain("软件与服务");
    expect(markup).toContain("正在读取服务状态");
    expect(markup).toContain("系统脉冲");
    expect(markup).toContain("本地服务");
  });
});

describe("localCoveragePlan", () => {
  it("returns no actions for an empty coverage view", () => {
    const plan = localCoveragePlan(
      selectCandidateCoverage(readyModule(coverage([]))),
    );
    expect(plan.actions).toEqual([]);
  });

  it("orders actions by coverage priority, keeps a stable order, and bounds the list", () => {
    const view = selectCandidateCoverage(
      readyModule(
        coverage([
          candidate("excluded-1", "EXCLUDED"),
          candidate("unsupported-1", "DETECTED_UNSUPPORTED"),
          candidate("read-only-1", "MANAGED_READ_ONLY"),
          candidate("writable-1", "MANAGED_WRITABLE"),
          candidate("writable-2", "MANAGED_WRITABLE"),
        ]),
      ),
    );

    const plan = localCoveragePlan(view);
    expect(plan.actions).toHaveLength(MAX_COVERAGE_ACTIONS);
    expect(plan.actions.map((action) => action.candidateId)).toEqual([
      "writable-1",
      "writable-2",
      "read-only-1",
    ]);
  });
});

describe("DashboardPage overview wall", () => {
  const markup = renderToStaticMarkup(
    <DashboardPage state={{ status: "ready", snapshot: readySnapshot(readyModule(FOUR_CLASS_COVERAGE)) }} />,
  );

  it("按固定顺序排列：状态行、服务 8 栏、Caddy/环境变量/AI 配置/应用配置各 4 栏，然后是系统区", () => {
    const spans = [...markup.matchAll(/page-shell__cell--span-(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(spans).toEqual([12, 8, 4, 4, 4, 4, 12, 12, 6, 6, 12]);
    const order = ["打开服务", "打开 Caddy", "打开环境变量", "打开 AI 配置", "打开应用配置"].map(
      (text) => markup.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("每个模块舱位的主操作是可见文字按钮，未加载的舱位显示未加载", () => {
    for (const bay of ["打开 Caddy", "打开环境变量", "打开 AI 配置", "打开应用配置"]) {
      expect(markup).toMatch(new RegExp(`<button[^>]*>${bay}</button>`));
    }
    expect(markup.match(/未加载/g) ?? []).toHaveLength(4);
  });

  it("服务舱位在读取中时显示读取中，不显示数字", () => {
    expect(markup).toMatch(/<h2[^>]*>服务<\/h2>/);
    expect(markup).toContain("读取中");
  });

  it("概览状态行给出当前状态与重新扫描，不再有第二个 h1 与看板切换", () => {
    expect(markup).toContain("当前状态稳定");
    expect(markup).toMatch(/<button[^>]*>重新扫描<\/button>/);
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("page-shell__header");
    expect(markup).not.toContain("▣");
    expect(markup).not.toContain("看板");
  });
});

// The legacy decoder regression stays covered from T112.
describe("DashboardPage discovery decoding", () => {
  it("accepts absent evidence paths serialized as null", () => {
    const snapshot = decodeDiscoverySnapshot({
      refreshId: "refresh-1",
      startedAtEpochMs: 1,
      system: {
        status: "READY",
        data: {
          completeness: "COMPLETE",
          osVersion: "15.0",
          architecture: "arm64",
          homeDirectory: "~",
          applications: [
            {
              appId: "git",
              displayName: "Git",
              status: "ABSENT",
              evidence: [
                {
                  kind: "CONFIG_PRESENT",
                  present: false,
                  label: "~/.gitconfig",
                  path: null,
                },
              ],
            },
          ],
          issues: [],
        },
      },
      brew: { status: "LOADING" },
      candidates: { status: "LOADING" },
    });

    expect(snapshot.system.status).toBe("READY");
  });
});
