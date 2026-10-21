import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  configFile,
  launchdService,
  sampleDiscovery,
} from "./launchdFixtures";
import {
  EMPTY_FILTER,
  type DiscoveryState,
} from "./launchdModel";
import { ServiceLogs } from "./ServiceLogs";
import { ServicesView } from "./ServicesView";

const WITH_LOGS = configFile({
  details: {
    programArguments: ["/usr/bin/true"],
    argumentsTruncated: false,
    environmentKeys: [],
    standardOutPath: "~/Library/Logs/job.log",
    standardErrorPath: "~/Library/Logs/job.err",
  },
});

const WITHOUT_LOGS = configFile({
  details: {
    programArguments: ["/usr/bin/true"],
    argumentsTruncated: false,
    environmentKeys: [],
  },
});

const LOG_CONTROLS = ["标准输出", "标准错误", "授权读取日志…"];
const MODIFYING_WORDS = [
  "启动",
  "停止",
  "重启",
  "卸载",
  "禁用自启",
  "启用自启",
  "删除",
  "接管",
  "创建",
];

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(
    (match) => match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

describe("ServiceLogs", () => {
  it("says so plainly when the plist declares no log file", () => {
    const markup = renderToStaticMarkup(
      <ServiceLogs
        service={launchdService({ configFiles: [WITHOUT_LOGS] })}
      />,
    );
    expect(markup).toContain("无可用文件日志");
    expect(buttonLabels(markup)).toEqual([]);
  });

  it("offers only the authorization control before anything is read", () => {
    const markup = renderToStaticMarkup(
      <ServiceLogs service={launchdService({ configFiles: [WITH_LOGS] })} />,
    );
    expect(markup).toContain("输出路径：~/Library/Logs/job.log");
    expect(buttonLabels(markup)).toEqual(
      expect.arrayContaining(LOG_CONTROLS),
    );
    expect(buttonLabels(markup).every((label) => LOG_CONTROLS.includes(label))).toBe(
      true,
    );
    expect(markup).not.toContain("导出日志");
    expect(markup).not.toContain("停止追踪");
  });

  it("names a missing stream as undeclared and never offers a modifying control", () => {
    const markup = renderToStaticMarkup(
      <ServiceLogs
        service={launchdService({
          configFiles: [
            configFile({
              details: {
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
                standardOutPath: "~/Library/Logs/job.log",
              },
            }),
          ],
        })}
      />,
    );
    expect(markup).toContain("标准错误（未声明）");
    expect(buttonLabels(markup).some((label) => MODIFYING_WORDS.some((word) => label.includes(word)))).toBe(
      false,
    );
  });
});

describe("the page's log slot", () => {
  it("adds only read-only log controls beside a read-only job", () => {
    const service = launchdService({ configFiles: [WITH_LOGS] });
    const state: DiscoveryState = {
      status: "ready",
      discovery: sampleDiscovery({ services: [service] }),
      refreshing: false,
    };
    const markup = renderToStaticMarkup(
      <ServicesView
        evidence={{ status: "ready", summaries: [] }}
        filter={EMPTY_FILTER}
        onFilterChange={() => {}}
        onRefresh={() => {}}
        onSelect={() => {}}
        refreshDisabled={false}
        renderLogs={(selected) => <ServiceLogs service={selected} />}
        selectedId={service.id}
        state={state}
      />,
    );
    const logsStart = markup.indexOf("任务日志");
    expect(logsStart).toBeGreaterThan(-1);
    const logs = markup.slice(logsStart);
    const labels = buttonLabels(logs);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => LOG_CONTROLS.includes(label))).toBe(true);
  });

  it("renders no log block when the page supplies none", () => {
    const service = launchdService({ configFiles: [WITH_LOGS] });
    const state: DiscoveryState = {
      status: "ready",
      discovery: sampleDiscovery({ services: [service] }),
      refreshing: false,
    };
    const markup = renderToStaticMarkup(
      <ServicesView
        evidence={{ status: "ready", summaries: [] }}
        filter={EMPTY_FILTER}
        onFilterChange={() => {}}
        onRefresh={() => {}}
        onSelect={() => {}}
        refreshDisabled={false}
        selectedId={service.id}
        state={state}
      />,
    );
    expect(markup).not.toContain("任务日志");
    expect(markup).not.toContain("授权读取日志");
  });
});
