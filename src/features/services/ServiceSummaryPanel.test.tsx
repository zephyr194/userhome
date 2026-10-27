// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleContext, createLocaleValue } from "../../i18n/localeContext";
import {
  configFile,
  createdService,
  launchdService,
  sampleDiscovery,
} from "./launchdFixtures";
import { EMPTY_FILTER, type DiscoveryState } from "./launchdModel";
import { ServicesView, type ServicesViewProps } from "./ServicesView";
import { ServiceLogs } from "./ServiceLogs";
import { ServiceSummaryPanel } from "./ServiceSummaryPanel";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function readyState(services = [launchdService()]): DiscoveryState {
  return {
    status: "ready",
    discovery: sampleDiscovery({ services }),
    refreshing: false,
  };
}

function pageProps(
  overrides: Partial<ServicesViewProps> = {},
): ServicesViewProps {
  const service = launchdService();
  return {
    state: readyState([service]),
    evidence: { status: "ready", summaries: [] },
    filter: EMPTY_FILTER,
    selectedId: service.id,
    refreshDisabled: false,
    onFilterChange: () => {},
    onSelect: () => {},
    onRefresh: () => {},
    ...overrides,
  };
}

function summarySections(container: HTMLElement): string[] {
  return [...container.querySelectorAll("section[aria-labelledby] h4")].map(
    (heading) => heading.textContent ?? "",
  );
}

const WITHOUT_LOGS = configFile({
  details: {
    programArguments: ["/usr/bin/true"],
    argumentsTruncated: false,
    environmentKeys: [],
  },
});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("service summary panel", () => {
  it("reads the log paths from the primary config file, not from the first one", () => {
    const service = launchdService({
      configFiles: [
        configFile({ path: "/tmp/plain.plist", details: undefined }),
        configFile({
          path: "/tmp/main.plist",
          details: {
            programArguments: ["/usr/bin/true"],
            argumentsTruncated: false,
            environmentKeys: [],
            standardOutPath: "/tmp/main.out.log",
          },
        }),
      ],
    });
    render(<ServiceSummaryPanel service={service} />);
    expect(screen.getByText("/tmp/main.out.log")).toBeTruthy();
    expect(screen.queryByText("没有配置日志文件，输出由系统日志接管。")).toBeNull();
  });

  it("shows the four sections in order", () => {
    const { container } = render(<ServiceSummaryPanel service={launchdService()} />);
    expect(summarySections(container)).toEqual([
      "它是什么",
      "什么时候启动",
      "文件位置",
      "日志",
    ]);
  });

  it("says the purpose is unknown and shows the program path when nothing matches", () => {
    const { container } = render(<ServiceSummaryPanel service={launchdService()} />);
    const what = container.querySelector("#services-summary-what")!.closest("section")!;
    expect(within(what).getByText("作用未知")).toBeTruthy();
    expect(within(what).getByText("/usr/local/bin/example")).toBeTruthy();
  });

  it("names the Homebrew source and the basis of a Homebrew job", () => {
    const { container } = render(
      <ServiceSummaryPanel
        service={launchdService({
          id: "gui/501/homebrew.mxcl.fancytool",
          label: "homebrew.mxcl.fancytool",
          labelSource: "PLIST",
        })}
      />,
    );
    const what = container.querySelector("#services-summary-what")!.closest("section")!;
    expect(what.textContent).toContain("Homebrew 安装的 fancytool");
    expect(what.textContent).toContain("Homebrew 安装");
  });

  it("explains when the job starts in one sentence", () => {
    const { container } = render(<ServiceSummaryPanel service={launchdService()} />);
    const when = container.querySelector("#services-summary-when")!.closest("section")!;
    expect(when.textContent).toContain("登录时启动");
    expect(when.textContent).toContain("满足条件时保持运行");
  });

  it("shows the run state and the PID as text, not color alone", () => {
    const { container } = render(<ServiceSummaryPanel service={launchdService()} />);
    const when = container.querySelector("#services-summary-when")!.closest("section")!;
    expect(when.textContent).toContain("运行中");
    expect(when.textContent).toContain("4242");
  });

  it("keeps the allow-listed actions in the when-section for a modifiable job", () => {
    render(<ServiceSummaryPanel service={createdService()} />);
    expect(screen.getByText(/先预览再确认/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("states the action scope without repeating the button list", () => {
    render(<ServiceSummaryPanel service={createdService()} />);
    expect(screen.queryByText(/仅限加载/)).toBeNull();
    expect(screen.getByText(/不会删除配置文件/)).toBeTruthy();
  });

  it("copies a configuration path and confirms it", async () => {
    render(<ServiceSummaryPanel service={launchdService()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "复制路径" })[0]);
    expect(await screen.findByText("已复制路径。")).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "~/Library/LaunchAgents/com.example.agent.plist",
    );
  });

  it("explains a failed copy and leaves the path on screen to select", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    render(<ServiceSummaryPanel service={launchdService()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "复制路径" })[0]);
    expect(await screen.findByText("复制失败：请手动选择路径复制。")).toBeTruthy();
    expect(screen.getAllByText("~/Library/LaunchAgents/com.example.agent.plist").length).toBeGreaterThan(0);
  });

  it("says no log file is configured and offers no log view", () => {
    render(
      <ServiceSummaryPanel
        service={launchdService({ configFiles: [WITHOUT_LOGS] })}
        renderLogs={() => <p>日志内容</p>}
      />,
    );
    expect(screen.getByText("没有配置日志文件，输出由系统日志接管。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看日志" })).toBeNull();
  });

  it("opens the existing log block from 查看日志", () => {
    render(
      <ServiceSummaryPanel
        service={launchdService()}
        renderLogs={() => <p>日志内容</p>}
      />,
    );
    expect(screen.queryByText("日志内容")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看日志" }));
    expect(screen.getByText("日志内容")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起日志" })).toBeTruthy();
  });
});

describe("the log block behind 查看日志", () => {
  it("offers only read-only log controls for a read-only job", () => {
    render(
      <ServiceSummaryPanel
        service={launchdService()}
        renderLogs={(service) => <ServiceLogs service={service} />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看日志" }));
    expect(screen.getByRole("button", { name: "授权读取日志…" })).toBeTruthy();
    for (const word of ["启动", "停止", "重启", "卸载", "删除"]) {
      expect(screen.queryByRole("button", { name: new RegExp(word) })).toBeNull();
    }
  });
});

describe("service page detail pane", () => {
  it("keeps every original detail field inside a collapsed 详细信息 disclosure", () => {
    const { container } = render(<ServicesView {...pageProps()} />);
    const disclosure = container.querySelector("details.services-details");
    expect(disclosure).toBeTruthy();
    expect(disclosure!.querySelector("summary")!.textContent).toBe("详细信息");
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
    const fields = [
      "label",
      "域",
      "上次退出",
      "判定依据",
      "只读原因",
      "可执行文件",
      "启动参数",
      "环境变量",
      "RunAtLoad",
      "KeepAlive",
      "标准输出",
      "标准错误",
      "Disabled",
      "UserName",
      "label 来源",
      "配置文件状态",
      "发现来源",
      "所在目录",
      "文件类型",
      "内容读取",
    ];
    for (const field of fields) {
      expect(disclosure!.textContent, field).toContain(field);
    }
  });

  it("renders the page in English without Chinese text", () => {
    const { container } = render(
      <LocaleContext.Provider value={createLocaleValue("en")}>
        <ServicesView {...pageProps()} renderLogs={(service) => <p>{service.label}</p>} />
      </LocaleContext.Provider>,
    );
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
    expect(screen.getByText("What it is")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
  });
});
