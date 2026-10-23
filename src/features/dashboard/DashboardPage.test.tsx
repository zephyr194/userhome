// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverySnapshot } from "../../ipc/discovery";
import type { NavigationIntent } from "../../app/routeDefinitions";

const mocks = vi.hoisted(() => ({
  readZshStartupFiles: vi.fn(),
  listGrants: vi.fn(),
  listAppConfigEntries: vi.fn(),
}));

vi.mock("../../ipc/environment", () => ({ readZshStartupFiles: mocks.readZshStartupFiles }));
vi.mock("../../ipc/grants", () => ({ listGrants: mocks.listGrants }));
vi.mock("../../ipc/appConfig", () => ({ listAppConfigEntries: mocks.listAppConfigEntries }));

type Rtl = typeof import("@testing-library/react");

const srcRoot = join(process.cwd(), "src");

const TOOL_IDS = [
  ["claude-code", "Claude Code"],
  ["codex-cli", "Codex CLI"],
  ["gemini-cli", "Gemini CLI"],
  ["copilot-cli", "GitHub Copilot CLI"],
] as const;

function aiReportWire(): Record<string, unknown> {
  return {
    tools: TOOL_IDS.map(([id, displayName]) => ({
      id,
      displayName,
      installStatus: "missing",
      installSource: null,
      displayPath: null,
      invalidReason: null,
      version: null,
      configPresence: "notRegistered",
      configDisplayPath: null,
      references: ["https://example.com/docs"],
      verificationNote: "待核验",
    })),
  };
}

function readySnapshot(refreshId = "refresh-1"): DiscoverySnapshot {
  return {
    refreshId,
    startedAtEpochMs: 1,
    system: {
      status: "READY",
      data: {
        completeness: "COMPLETE",
        osVersion: "15.0",
        architecture: "arm64",
        homeDirectory: "~",
        shell: "/bin/zsh",
        applications: [],
        issues: [],
      },
    },
    brew: { status: "LOADING" },
    candidates: { status: "LOADING" },
  };
}

const READY_STATE = { status: "ready" as const, snapshot: readySnapshot() };

let rtl: Rtl;
let DashboardPage: typeof import("./DashboardPage").DashboardPage;
let clearOverviewFactCache: typeof import("./overviewFacts").clearOverviewFactCache;
let listServiceCalls = 0;
let detectCalls = 0;

async function freshModules(): Promise<void> {
  vi.resetModules();
  rtl = await import("@testing-library/react");
  ({ DashboardPage } = await import("./DashboardPage"));
  ({ clearOverviewFactCache } = await import("./overviewFacts"));
}

function mockBackend(): void {
  listServiceCalls = 0;
  detectCalls = 0;
  mockIPC((command) => {
    if (command === "list_services") {
      listServiceCalls += 1;
      return [];
    }
    if (command === "ai_config_detect") {
      detectCalls += 1;
      return aiReportWire();
    }
    throw new Error(`unexpected command ${command}`);
  });
}

function zshOverview() {
  return {
    files: [
      { outcome: { status: "READY" } },
      { outcome: { status: "READY" } },
      { outcome: { status: "NOT_LOCATED", message: "未定位" } },
      { outcome: { status: "UNAVAILABLE", reason: "IO", message: "无法读取" } },
    ],
  } as never;
}

function factCell(name: string): HTMLElement {
  const button = rtl.screen.getByRole("button", { name: new RegExp(`^${name}`) });
  const cell = button.closest("article");
  if (!cell) throw new Error(`cell ${name} not found`);
  return cell;
}

beforeEach(async () => {
  mocks.readZshStartupFiles.mockReset().mockResolvedValue(zshOverview());
  mocks.listGrants.mockReset().mockResolvedValue([
    { id: "1", kind: "DIRECTORY", purpose: "CONFIG_DIRECTORY", displayPath: "~/a", createdAtEpochMs: 1 },
    { id: "2", kind: "DIRECTORY", purpose: "CADDY_WORK_DIR", displayPath: "~/c", createdAtEpochMs: 1 },
  ]);
  mocks.listAppConfigEntries.mockReset().mockResolvedValue([{}, {}, {}]);
  mockBackend();
  await freshModules();
});

afterEach(() => {
  rtl.cleanup();
  clearMocks();
  clearOverviewFactCache();
});

describe("DashboardPage fact ledger", () => {
  it("renders the four fact cells in order with the system strip above them", () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    const order = [...rtl.screen.getAllByRole("article")].map((cell) => cell.textContent ?? "");
    expect(order.map((text) => text.slice(0, 2))).toEqual(["服务", "AI", "环境", "应用"]);
  });

  it("removes the retired overview sections and read-all controls", () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    const text = document.body.textContent ?? "";
    for (const removed of ["用户目录配置", "关注事项", "软件与服务", "最近活动", "系统脉冲", "重新扫描", "读取摘要"]) {
      expect(text).not.toContain(removed);
    }
  });

  it("does not read the zsh, grant, or app config sources on open", () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    expect(mocks.readZshStartupFiles).not.toHaveBeenCalled();
    expect(mocks.listGrants).not.toHaveBeenCalled();
    expect(mocks.listAppConfigEntries).not.toHaveBeenCalled();
    expect(detectCalls).toBe(0);
  });

  it("shows a read button for the environment cell, then the number after reading", async () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    const cell = factCell("环境变量");
    expect(cell.textContent).toContain("未读取");
    rtl.fireEvent.click(rtl.within(cell).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("zsh 启动文件 2 个 · 授权目录 1 个");
    expect(mocks.readZshStartupFiles).toHaveBeenCalledTimes(1);
    expect(mocks.listGrants).toHaveBeenCalledTimes(1);
    expect(rtl.within(cell).queryByRole("button", { name: "读取" })).toBeNull();
    expect(cell.textContent).toContain("刚刚读取");
  });

  it("does not read the environment again after leaving and returning to the overview", async () => {
    const first = rtl.render(<DashboardPage state={READY_STATE} />);
    rtl.fireEvent.click(rtl.within(factCell("环境变量")).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("zsh 启动文件 2 个 · 授权目录 1 个");
    first.unmount();

    rtl.render(<DashboardPage state={READY_STATE} />);
    expect(factCell("环境变量").textContent).toContain("zsh 启动文件 2 个");
    expect(mocks.readZshStartupFiles).toHaveBeenCalledTimes(1);
    expect(mocks.listGrants).toHaveBeenCalledTimes(1);
  });

  it("reads app config entries on demand and shows the count", async () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    rtl.fireEvent.click(rtl.within(factCell("应用配置")).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("已发现的应用配置条目数。");
    expect(factCell("应用配置").textContent).toContain("3");
    expect(mocks.listAppConfigEntries).toHaveBeenCalledTimes(1);
  });

  it("shows a one-line reason and a retry when a read fails", async () => {
    mocks.listAppConfigEntries.mockRejectedValueOnce({ code: "INTERNAL", message: "配置目录不可读", retryable: true });
    rtl.render(<DashboardPage state={READY_STATE} />);
    rtl.fireEvent.click(rtl.within(factCell("应用配置")).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText(/读取失败：配置目录不可读/);
    expect(rtl.within(factCell("应用配置")).getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("reads the AI tools only from the cache and reads them on demand", async () => {
    rtl.render(<DashboardPage state={READY_STATE} />);
    const cell = factCell("AI 工具");
    expect(cell.textContent).toContain("—");
    expect(cell.textContent).toContain("未读取");
    expect(detectCalls).toBe(0);

    rtl.fireEvent.click(rtl.within(cell).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("未发现已安装的 AI 工具。");
    expect(cell.textContent).toContain("0/4");
    expect(detectCalls).toBe(1);
  });

  it("shows the AI tools from the existing cache on re-entry without detecting again", async () => {
    const first = rtl.render(<DashboardPage state={READY_STATE} />);
    rtl.fireEvent.click(rtl.within(factCell("AI 工具")).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("未发现已安装的 AI 工具。");
    first.unmount();

    rtl.render(<DashboardPage state={READY_STATE} />);
    expect(factCell("AI 工具").textContent).toContain("0/4");
    expect(detectCalls).toBe(1);
  });

  it("navigates to the matching page when a cell is clicked", () => {
    const navigate = vi.fn<(intent: NavigationIntent) => void>();
    rtl.render(<DashboardPage onNavigate={navigate} state={READY_STATE} />);
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /^应用配置/ }));
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /^环境变量/ }));
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /^AI 工具/ }));
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /^服务/ }));
    expect(navigate.mock.calls.map(([intent]) => intent)).toEqual([
      { routeId: "appConfig" },
      { routeId: "environment" },
      { routeId: "aiConfig" },
      { routeId: "services" },
    ]);
  });

  it("re-reads the cells that were read when a header refresh completes", async () => {
    const view = rtl.render(<DashboardPage refresh={{ status: "idle" }} state={READY_STATE} />);
    rtl.fireEvent.click(rtl.within(factCell("环境变量")).getByRole("button", { name: "读取" }));
    await rtl.screen.findByText("zsh 启动文件 2 个 · 授权目录 1 个");

    view.rerender(<DashboardPage refresh={{ status: "refreshing" }} state={READY_STATE} />);
    view.rerender(<DashboardPage refresh={{ status: "ready", completedAt: "2026-10-22T10:00:00Z" }} state={READY_STATE} />);
    await rtl.waitFor(() => expect(mocks.readZshStartupFiles).toHaveBeenCalledTimes(2));
    expect(mocks.listAppConfigEntries).not.toHaveBeenCalled();
    expect(detectCalls).toBe(0);
  });

  it("counts services from the discovery refresh and shows the service page on click", async () => {
    const navigate = vi.fn<(intent: NavigationIntent) => void>();
    rtl.render(<DashboardPage onNavigate={navigate} state={READY_STATE} />);
    await rtl.screen.findByText("UserHome 管理的任务，运行中 0 个");
    expect(listServiceCalls).toBe(1);
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: /^服务/ }));
    expect(navigate).toHaveBeenCalledWith({ routeId: "services" });
  });
});

describe("DashboardPage single-screen layout", () => {
  it("keeps the page to one scroll-free region with no nested sections", () => {
    const markup = rtl.render(<DashboardPage state={READY_STATE} />).container.innerHTML;
    expect(markup.match(/<section\b/g) ?? []).toHaveLength(2);

    const sourceDir = join(srcRoot, "features", "dashboard");
    for (const name of ["DashboardPage.tsx", "overviewFacts.ts", "useServiceOverview.ts"]) {
      expect(readFileSync(join(sourceDir, name), "utf8")).not.toMatch(/overflow-y|overflow:\s*auto/);
    }

    const css = readFileSync(join(srcRoot, "styles", "global.css"), "utf8");
    const block = css.slice(css.indexOf("/* r5b-ov"), css.indexOf("/* /r5b-ov */"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/overflow-y|overflow:\s*(auto|scroll)/);
    expect(block).not.toMatch(/clip-path|gradient|box-shadow|outline/);
  });
});
