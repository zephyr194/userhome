// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render as renderInDom,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { ServiceSummary } from "../../ipc/services";
import {
  APPLE_OWNERSHIP,
  CREATED_LABEL,
  DAEMON_OWNERSHIP,
  THIRD_PARTY_OWNERSHIP,
  configFile,
  createdService,
  launchdService,
  partialDiscovery,
  sampleDiscovery,
  sourceReport,
} from "./launchdFixtures";
import { LaunchdServiceDetails } from "./LaunchdServiceDetails";
import { ServiceSummaryPanel } from "./ServiceSummaryPanel";
import {
  EMPTY_FILTER,
  type DiscoveryState,
  type ServiceFilter,
} from "./launchdModel";
import { ServicesView, type ServicesViewProps } from "./ServicesView";

const ERROR: AppError = {
  code: "PROCESS_FAILED",
  message: "无法读取 launchd。",
  retryable: true,
};

const noop = () => {};

afterEach(cleanup);

function element(overrides: Partial<ServicesViewProps> = {}): ReactElement {
  const state: DiscoveryState = {
    status: "ready",
    discovery: sampleDiscovery(),
    refreshing: false,
  };
  return (
    <ServicesView
      state={state}
      evidence={{ status: "ready", summaries: [] }}
      filter={EMPTY_FILTER}
      selectedId={undefined}
      refreshDisabled={false}
      onFilterChange={noop}
      onSelect={noop}
      onRefresh={noop}
      {...overrides}
    />
  );
}

function view(overrides: Partial<ServicesViewProps> = {}): string {
  return renderToStaticMarkup(element(overrides));
}

function ready(
  discovery = sampleDiscovery(),
  extra: { refreshing?: boolean; refreshError?: AppError } = {},
): DiscoveryState {
  return { status: "ready", discovery, refreshing: false, ...extra };
}

/** Tab stops of the job rows only; the show-system checkbox is also focusable. */
function rowTabStops(markup: string, value: "0" | "-1"): string[] {
  return markup.match(/<button[^>]*services-inventory-row[^>]*>/g)?.filter((tag) =>
    tag.includes(`tabindex="${value}"`),
  ) ?? [];
}

function withFilter(filter: Partial<ServiceFilter>): ServiceFilter {
  return { ...EMPTY_FILTER, ...filter };
}

describe("services view states", () => {
  it("renders loading", () => {
    const markup = view({ state: { status: "loading" } });
    expect(markup).toContain("正在读取本机状态…");
    expect(markup).toContain('aria-busy="true"');
  });

  it("renders a first-load error with a retry button", () => {
    const markup = view({ state: { status: "error", error: ERROR } });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(ERROR.message);
    expect(markup).toContain(">重试<");
  });

  it("tells the reader where to retry when the selected detail cannot load", () => {
    const markup = view({
      state: { status: "error", error: ERROR },
      selectedId: sampleDiscovery().services[0].id,
    });
    expect(markup).toContain("读取失败，暂时无法显示所选任务的详情。请使用左侧清单中的“重试”。");
  });

  it("puts the first-load retry inside a full-width alert box", () => {
    const { container } = renderInDom(
      element({ state: { status: "error", error: ERROR } }),
    );
    const alert = screen.getByRole("alert");
    const retry = screen.getByRole("button", { name: "重试" });

    expect(alert.contains(retry)).toBe(true);
    expect(alert.className).not.toContain("rounded-control");
    expect(alert.parentElement?.className).toContain("py-ui-12");
    expect(alert.parentElement?.className).not.toMatch(/(^|\s)p-ui-12(\s|$)/);
    expect(container.querySelector("header")?.className).not.toContain("bg-surface-muted");
    expect(container.querySelector("details")?.parentElement?.className).not.toContain(
      "bg-surface-muted",
    );
  });

  it("renders empty only when discovery was complete", () => {
    const empty = view({
      state: ready(sampleDiscovery({ services: [] })),
    });
    expect(empty).toContain("没有发现常驻任务");
    const partial = view({
      state: ready({ ...partialDiscovery(), services: [] }),
    });
    expect(partial).toContain("不能据此认为没有常驻任务");
    expect(partial).not.toContain("没有发现常驻任务");
  });

  it("shows a partial notice naming each failed source and the reason", () => {
    const markup = view({ state: ready(partialDiscovery()) });
    expect(markup).toContain("部分来源未能读取");
    expect(markup).toContain("结果可能不完整");
    expect(markup).toContain("launchctl print system");
    expect(markup).toContain("权限不足");
    // Rows from the sources that did work are still listed.
    expect(markup).toContain("com.example.agent");
  });

  it("says when the list was truncated", () => {
    const markup = view({
      state: ready(sampleDiscovery({ truncated: true, complete: false })),
    });
    expect(markup).toContain("已截断");
  });

  it("shows no partial notice for a complete result", () => {
    expect(view()).not.toContain("部分来源未能读取");
  });

  it("keeps the list while refreshing and after a failed refresh", () => {
    const refreshing = view({
      state: ready(sampleDiscovery(), { refreshing: true }),
      refreshDisabled: true,
    });
    expect(refreshing).toContain("正在刷新");
    expect(refreshing).toContain("com.example.agent");
    expect(refreshing).toMatch(/disabled=""[^>]*>刷新/);

    const failed = view({
      state: ready(sampleDiscovery(), { refreshError: ERROR }),
    });
    expect(failed).toContain("刷新失败");
    expect(failed).toContain(ERROR.message);
    expect(failed).toContain("以下为上次读取的结果");
    expect(failed).toContain("com.example.agent");
  });
});

describe("services list", () => {
  it("describes the list without calling it read-only", () => {
    const markup = view();
    expect(markup).toContain("本机 launchd 常驻任务");
    expect(markup).not.toContain("只读查看");
  });

  it("shows a readable name, a purpose line and the status in each row", () => {
    const markup = view();
    expect(markup).toContain("example.agent");
    expect(markup).toContain("运行中");
    expect(markup).toContain("example");
    expect(markup).not.toContain("来源：");
    expect(markup).not.toContain("归属：");
  });

  it("keeps path, executable, PID and exit code out of the rows", () => {
    const markup = view();
    expect(markup).not.toContain("~/Library/LaunchAgents/com.example.agent.plist");
    expect(markup).not.toContain("/usr/local/bin/example");
    expect(markup).not.toContain("PID 4242");
    expect(markup).not.toContain("退出码 0");
  });

  it("gives the full label as a title so a truncated-looking row still shows it", () => {
    const markup = view();
    expect(markup).toMatch(/<strong[^>]*title="com\.example\.agent"/);
  });

  it("moves the path, domain, PID and exit code into the selected details", () => {
    const markup = view({ selectedId: "gui/501/com.example.agent" });
    expect(markup).toContain("用户会话");
    expect(markup).toContain("~/Library/LaunchAgents/com.example.agent.plist");
    expect(markup).toContain("/usr/local/bin/example");
    expect(markup).toContain("4242");
    expect(markup).toContain("退出码 0");
  });

  it("shows the load and file correlation in details, not in the rows", () => {
    const rows = view();
    expect(rows).toContain("未加载");
    expect(rows).not.toContain("有配置文件，当前未加载");
    const fileOnly = view({ selectedId: "gui/501/com.example.disabled" });
    expect(fileOnly).toContain("有配置文件，当前未加载");
  });

  it("is a keyboard list with a roving tab stop, labels and the selected row marked", () => {
    const markup = view({ selectedId: "gui/501/com.example.idle" });
    expect(markup).toMatch(/<ul[^>]*aria-label="用户自建的，4 项"/);
    expect(markup).toContain('aria-current="true"');
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    // One tab stop: the selected row. The show-system checkbox is a separate control.
    expect(rowTabStops(markup, "0")).toHaveLength(1);
    expect(rowTabStops(markup, "-1")).toHaveLength(3);
    expect(markup).toMatch(
      /aria-label="com\.example\.idle，用户代理，已加载，未运行/,
    );
    expect(markup).toContain("services-inventory-row--selected");
  });

  it("falls back to the first row as the tab stop with no selection", () => {
    const markup = view();
    expect(rowTabStops(markup, "0")).toHaveLength(1);
    expect(markup).not.toContain('aria-current="true"');
  });

  it("never prints PID or exit text for jobs without them", () => {
    const markup = view({
      state: ready(
        sampleDiscovery({
          services: [
            launchdService({
              runState: "NOT_RUNNING",
              pid: undefined,
              lastExit: undefined,
            }),
          ],
        }),
      ),
    });
    expect(markup).not.toContain("PID");
  });
});

describe("services filters", () => {
  it("renders labelled search and select controls", () => {
    const markup = view();
    expect(markup).toContain('type="search"');
    expect(markup).toContain("搜索任务");
    expect(markup).toContain("按 label、名称或路径搜索");
    for (const label of ["来源", "作用域", "状态"]) {
      expect(markup).toContain(`>${label}</label>`);
    }
    expect(markup.match(/aria-haspopup="listbox"/g)).toHaveLength(4);
    expect(markup).toContain(">全部来源<");
    expect(markup).toContain(">全部作用域<");
    expect(markup).toContain(">全部状态<");
    expect(markup).toContain("显示系统服务");
  });

  it("filters the list and reports how many are shown", () => {
    const markup = view({
      filter: withFilter({ scope: "SYSTEM_DAEMON", showSystem: true }),
    });
    expect(markup).toContain("显示 1 / 6 项");
    expect(markup).toContain("com.vendor.daemon");
    expect(markup).not.toContain("com.example.idle");
    // Without the toggle, the same filter finds nothing: system services are hidden.
    expect(view({ filter: withFilter({ scope: "SYSTEM_DAEMON" }) })).toContain("显示 0 / 4 项");
  });

  it("explains an empty filter result and offers to clear it", () => {
    const markup = view({ filter: withFilter({ query: "zzz-none" }) });
    expect(markup).toContain("没有符合筛选条件的任务");
    expect(markup).toContain(">清除筛选<");
    expect(markup).toContain("显示 0 / 4 项");
  });
});

describe("stable selection in the view", () => {
  it("shows an already-gone notice instead of switching silently", () => {
    const markup = view({ selectedId: "gui/501/com.removed.since" });
    expect(markup).toContain("已不存在");
    expect(markup).toContain("gui/501/com.removed.since");
    expect(markup).not.toContain('aria-current="true"');
    // No other task's details are shown in its place.
    expect(markup).not.toContain('id="service-details-heading"');
  });

  it("keeps showing a selected task that the filter hides, with a note", () => {
    const markup = view({
      selectedId: "gui/501/com.example.idle",
      filter: withFilter({ scope: "SYSTEM_DAEMON" }),
    });
    expect(markup).toContain("被当前筛选条件隐藏");
    expect(markup).toContain('id="service-details-heading"');
  });

  it("asks for a selection when nothing is selected", () => {
    expect(view()).toContain("从清单中选择一项任务");
  });

  it("waits for the list before judging a restored selection", () => {
    const markup = view({
      state: { status: "loading" },
      selectedId: "gui/501/com.example.agent",
    });
    expect(markup).toContain("正在读取本机状态");
    expect(markup).not.toContain("已不存在");
  });
});

describe("read-only guarantee", () => {
  it("offers no mutating entries and no Caddy-only copy", () => {
    const markup = view({ selectedId: "system/com.apple.metadata.mds" });
    for (const word of [
      "启动",
      "停止",
      "重启",
      "删除",
      "创建",
      "卸载",
      "加载任务",
      "禁用",
      "接管",
    ]) {
      expect(markup).not.toContain(`>${word}<`);
    }
    expect(markup).not.toMatch(/仅\s*Caddy|只能管理|仅限\s*Caddy|Caddyfile/);
    expect(markup).toContain("只读");
    // The only buttons are navigation/filter helpers.
    const buttonLabels = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter((match) => !match[1].includes("services-inventory-row"))
      .map((match) => match[2].replace(/<[^>]+>/g, ""));
    expect(buttonLabels).toEqual([
      "刷新",
      "全部来源",
      "全部归属",
      "全部作用域",
      "全部状态",
    ]);
  });
});

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => !match[1].includes("services-inventory-row"))
    .map((match) => match[2].replace(/<[^>]+>/g, ""));
}

describe("service details", () => {
  const discovery = sampleDiscovery();
  const [agent, , , , loadedOnly, unmatched] = discovery.services;

  function details(
    service = agent,
    extra: Partial<Parameters<typeof LaunchdServiceDetails>[0]> = {},
  ): string {
    return renderToStaticMarkup(
      <LaunchdServiceDetails
        service={service}
        sources={discovery.sources}
        evidence={{ status: "ready", summaries: [] }}
        {...extra}
      />,
    );
  }

  it("does not repeat the section name as an eyebrow above the job label", () => {
    expect(details()).not.toContain(">任务详情<");
  });

  it("explains that source is not ownership only once, in the list filter", () => {
    expect(details()).not.toContain("不是归属判定");
  });

  it("shows every SVC-1 service field", () => {
    const markup = details();
    expect(markup).toContain('id="service-details-heading"');
    expect(markup).toContain("com.example.agent");
    expect(markup).toContain("gui/501/com.example.agent");
    expect(markup).toContain("label 来源");
    expect(markup).toContain("launchctl");
    expect(markup).toContain("用户会话");
    expect(markup).toContain("gui/501");
    expect(markup).toContain("用户代理");
    expect(markup).toContain("已加载，并找到同 label 的配置文件");
    expect(markup).toContain("运行中");
    expect(markup).toContain("4242");
    expect(markup).toContain("退出码 0");
    expect(markup).toContain("不代表");
    expect(markup).toContain("配置文件状态");
  });

  it("shows every config file field and the plist details", () => {
    const markup = details();
    expect(markup).toContain("~/Library/LaunchAgents/com.example.agent.plist");
    expect(markup).toContain("~/Library/LaunchAgents");
    expect(markup).toContain("普通文件");
    expect(markup).toContain("所有者 UID 501");
    expect(markup).toContain("已读取内容");
    expect(markup).toContain("/usr/local/bin/example");
    expect(markup).toContain("--serve");
    expect(markup).toContain("RunAtLoad");
    expect(markup).toContain("KeepAlive");
    expect(markup).toContain("满足条件时保持运行");
    expect(markup).toContain("SuccessfulExit");
    expect(markup).toContain("~/Library/Logs/example.out.log");
    expect(markup).toContain("~/Library/Logs/example.err.log");
    expect(markup).toContain("Disabled");
    expect(markup).toContain("UserName");
    expect(markup).toContain("alice");
  });

  it("keeps masked arguments masked and lists environment keys only", () => {
    const markup = details();
    expect(markup).toContain("--token=••••");
    expect(markup).toContain("API_TOKEN");
    expect(markup).toContain("PORT");
    expect(markup).toContain("仅显示变量名");
    expect(markup).not.toMatch(/API_TOKEN=/);
  });

  it("notes truncated arguments", () => {
    const markup = details(
      launchdService({
        configFiles: [
          configFile({
            details: {
              programArguments: ["/bin/x", "-a"],
              argumentsTruncated: true,
              environmentKeys: [],
            },
          }),
        ],
      }),
    );
    expect(markup).toContain("参数过多，已截断");
  });

  it("explains links, unreadable files and load-only jobs", () => {
    const link = details(unmatched);
    expect(link).toContain("符号链接");
    expect(link).toContain("指向预期位置之外");
    expect(link).toContain("~/dev/broken.plist");
    expect(link).toContain("符号链接，内容未读取");
    expect(link).toContain("配置文件没有可用的 label");
    expect(link).toContain("状态未知");

    const none = details(loadedOnly);
    expect(none).toContain("没有找到配置文件");
    expect(none).toContain("已加载，未在扫描位置找到配置文件");
  });

  it("lists every evidence source with its result and reason", () => {
    const partial = partialDiscovery();
    const markup = details(agent, { sources: partial.sources });
    for (const label of [
      "launchctl list",
      "launchctl print system",
      "~/Library/LaunchAgents",
      "/Library/LaunchAgents",
      "/Library/LaunchDaemons",
      "/System/Library/LaunchAgents",
      "/System/Library/LaunchDaemons",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("无法访问");
    expect(markup).toContain("权限不足，无法读取。");
    expect(markup).toContain("目录不存在");
    expect(markup).toContain("已读取");
    expect(markup).toContain("加载与运行状态可能不完整");
  });

  it("reports file read failures per source", () => {
    const markup = details(agent, {
      sources: [
        sourceReport({
          source: "USER_LAUNCH_AGENTS",
          status: "PARTIAL",
          reason: "FILE_ERRORS",
          failedFiles: 3,
        }),
      ],
    });
    expect(markup).toContain("部分读取");
    expect(markup).toContain("3 个文件未能读取");
  });

  it("adds Homebrew only as evidence for a Homebrew-labelled job", () => {
    const brew = launchdService({
      id: "gui/501/homebrew.mxcl.caddy",
      label: "homebrew.mxcl.caddy",
    });
    const summary: ServiceSummary = {
      serviceId: "caddy",
      displayName: "Caddy",
      state: "STARTED",
      status: "started",
      scope: "USER",
      user: "alice",
      manageable: true,
    };
    const withEvidence = details(brew, {
      evidence: { status: "ready", summaries: [summary] },
    });
    expect(withEvidence).toContain("Homebrew 来源证据");
    expect(withEvidence).toContain("brew services");
    expect(withEvidence).toContain("alice");
    expect(withEvidence).toContain("仅作证据");

    const unavailable = details(brew, { evidence: { status: "unavailable" } });
    expect(unavailable).toContain("Homebrew 证据不可用");

    const unrelated = details(agent, {
      evidence: { status: "ready", summaries: [summary] },
    });
    expect(unrelated).not.toContain("Homebrew");
  });

  it("has no action buttons and says it is read-only", () => {
    const markup = details(agent);
    expect(markup).not.toContain("<button");
    expect(markup).toContain("只读");
    expect(markup).toContain("不提供删除配置文件");
  });

  it("does not truncate long values", () => {
    const long =
      "/opt/very/long/path/that/must/wrap/everywhere/0123456789/0123456789/0123456789/binary";
    const markup = details(
      launchdService({
        configFiles: [
          configFile({
            details: {
              program: long,
              programArguments: [long, "--flag"],
              argumentsTruncated: false,
              environmentKeys: [],
            },
          }),
        ],
      }),
    );
    expect(markup).not.toContain("truncate");
    expect(markup).toContain(long);
  });
});

describe("services feature sources", () => {
  const directory = join(process.cwd(), "src", "features", "services");
  const sources = readdirSync(directory)
    .filter((name) => /^(launchd|Launchd|ServicesView|ServicesPage)/.test(name))
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => [name, readFileSync(join(directory, name), "utf8")] as const);

  it("finds the new page sources", () => {
    expect(sources.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        "launchdModel.ts",
        "LaunchdServiceDetails.tsx",
        "ServicesView.tsx",
        "ServicesPage.tsx",
      ]),
    );
  });

  it("never touches browser storage or logs", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, name).not.toMatch(/console\.(log|debug|info|warn|error)/);
    }
  });

  it("has no hardcoded Caddy-only copy", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/仅\s*Caddy|只能管理|仅限\s*Caddy|Caddyfile/);
    }
  });

  it("never calls a mutating service command", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(
        /previewServiceAction|executeServiceAction|ServiceActionDialog/,
      );
    }
  });
});

describe("ownership in the details", () => {
  const details = (service: Parameters<typeof LaunchdServiceDetails>[0]["service"]) =>
    renderToStaticMarkup(
      <LaunchdServiceDetails
        evidence={{ status: "ready", summaries: [] }}
        service={service}
        sources={sampleDiscovery().sources}
      />,
    );

  it("shows the class, the read-only verdict, the reasons and the evidence", () => {
    const markup = details(launchdService());
    expect(markup).toContain("归属与可修改性");
    expect(markup).toContain("当前用户代理");
    expect(markup).toContain("只读");
    expect(markup).toContain("尚未被 UserHome 接管");
    expect(markup).toContain("判定依据");
    expect(markup).toContain("位于 ~/Library/LaunchAgents");
    expect(markup).toContain("文件所有者是当前用户");
    expect(markup).toContain("不提供删除配置文件");
  });

  it.each([
    ["Apple", APPLE_OWNERSHIP, "Apple 管理", "Apple"],
    ["a system daemon", DAEMON_OWNERSHIP, "系统 daemon", "系统"],
    ["a third party", THIRD_PARTY_OWNERSHIP, "第三方", "符号链接"],
  ])("explains why %s is read-only", (_name, ownership, label, reason) => {
    const markup = details(launchdService({ ownership }));
    expect(markup).toContain(label);
    expect(markup).toContain("只读");
    expect(markup).toContain(reason);
    expect(markup).not.toMatch(/可修改(?!性)/);
    expect(markup).not.toContain("<button");
  });

  it("shows a created job as modifiable with exactly the allow-listed actions", () => {
    const markup = details(createdService());
    expect(markup).toContain("UserHome 自建");
    expect(markup).toContain("可修改");
    const summary = renderToStaticMarkup(
      <ServiceSummaryPanel service={createdService()} />,
    );
    expect(summary).toContain("先预览再确认");
    // A loaded, running job: only the actions that make sense, never delete,
    // take over or create. Copy-path buttons are not lifecycle actions.
    expect(buttonLabels(summary).filter((label) => label !== "复制路径")).toEqual([
      "重启",
      "停止",
      "卸载",
      "禁用自启",
      "启用自启",
    ]);
    for (const word of ["删除", "接管", "创建", "加载", "启动"]) {
      expect(summary).not.toContain(`>${word}<`);
    }
  });

  it("keeps every action off the page for every read-only ownership class", () => {
    const selected = [
      launchdService(),
      launchdService({ id: "a", label: "a", ownership: APPLE_OWNERSHIP }),
      launchdService({ id: "b", label: "b", ownership: DAEMON_OWNERSHIP }),
      launchdService({ id: "c", label: "c", ownership: THIRD_PARTY_OWNERSHIP }),
    ];
    for (const service of selected) {
      const state: DiscoveryState = ready(
        sampleDiscovery({ services: [service] }),
      );
      const markup = view({ state, selectedId: service.id });
      const buttons = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
        .filter((match) => !match[1].includes("services-inventory-row"))
        .map((match) => match[2].replace(/<[^>]+>/g, ""))
        .filter((label) => label !== "复制路径");
      expect(buttons, service.label).toEqual([
        "刷新",
        "全部来源",
        "全部归属",
        "全部作用域",
        "全部状态",
      ]);
    }
  });

  it("shows the allow-listed actions only for a modifiable job in the page", () => {
    const service = createdService();
    const state: DiscoveryState = ready(
      sampleDiscovery({ services: [service] }),
    );
    const buttons = [
      ...view({ state, selectedId: service.id }).matchAll(
        /<button([^>]*)>([\s\S]*?)<\/button>/g,
      ),
    ]
      .filter((match) => !match[1].includes("services-inventory-row"))
      .map((match) => match[2].replace(/<[^>]+>/g, ""))
      .filter((label) => label !== "复制路径");
    expect(buttons).toEqual([
      "刷新",
      "全部来源",
      "全部归属",
      "全部作用域",
      "全部状态",
      "重启",
      "停止",
      "卸载",
      "禁用自启",
      "启用自启",
    ]);
  });
});

describe("ownership in the list", () => {
  it("offers an ownership filter apart from the directory-based source filter", () => {
    const markup = view();
    expect(markup).toContain(">归属</label>");
    expect(markup).toContain(">来源</label>");
    expect(markup).toContain(">全部归属<");
    renderInDom(element());
    fireEvent.click(screen.getByRole("button", { name: "归属" }));
    for (const label of [
      "当前用户代理",
      "全局代理",
      "系统 daemon",
      "Apple 管理",
      "第三方",
      "UserHome 自建",
      "UserHome 已接管",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeTruthy();
    }
    expect(markup).toContain("来源按所在目录归类");
    expect(markup).toContain("归属由后端按所有者、位置与文件类型判定");
  });

  it("filters the list by ownership", () => {
    const markup = view({
      filter: withFilter({ ownership: "APPLE_MANAGED", showSystem: true }),
    });
    expect(markup).toContain("显示 1 / 6 项");
    expect(markup).toContain("com.apple.metadata.mds");
    expect(markup).not.toContain("com.vendor.daemon<");
  });

  it("shows the injector as a group heading instead of a row field", () => {
    const markup = view({ filter: withFilter({ showSystem: true }) });
    expect(markup).toContain("用户自建的");
    expect(markup).toContain("系统");
    expect(markup).not.toContain("归属：");
    expect(CREATED_LABEL).toContain("userhome.agent");
  });
});

describe("services sources never promise a modification", () => {
  it("has no mutating verbs wired to any control", () => {
    const directory = join(process.cwd(), "src", "features", "services");
    const files = readdirSync(directory)
      .filter((name) => /^(launchd|Launchd|ServicesView|ServicesPage)/.test(name))
      .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test.") && name !== "launchdFixtures.ts");
    expect(files).toContain("LaunchdServiceDetails.tsx");
    for (const name of files) {
      const source = readFileSync(join(directory, name), "utf8");
      expect(source, name).not.toMatch(
        /ensure_modifiable|adoptService|createService|deleteService|startService|stopService|unloadService|invokeCommand/,
      );
      if (name === "LaunchdServiceDetails.tsx") {
        expect(source).not.toMatch(/onClick|<Button|<button|onSubmit/);
      }
    }
  });
});
