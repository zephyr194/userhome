/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { APP_ROUTES } from "../../app/routeDefinitions";
import { Button } from "../../components/ui";
import type { ServiceState, ServiceSummary } from "../../ipc/services";
import { ModuleBay } from "./ModuleBay";
import { BAY_UNLOADED, OVERVIEW_MODULE_BAYS, serviceBay } from "./overviewBays";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

function service(serviceId: string, state: ServiceState): ServiceSummary {
  return {
    serviceId,
    displayName: serviceId,
    state,
    status: state,
    scope: "USER",
    manageable: false,
  };
}

function findButton(node: ReactNode): ReactElement<{ onClick?: unknown }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === Button) return node as ReactElement<{ onClick?: unknown }>;
  return findButton(node.props.children);
}

describe("serviceBay", () => {
  it("服务仍在读取时显示读取中，不输出数字", () => {
    expect(serviceBay({ status: "loading" })).toEqual({
      status: { tone: "neutral", label: "读取中", attention: false },
      figure: { label: "运行 / 停止", value: "—" },
    });
  });

  it("服务读取失败时与其他舱位一样显示未加载", () => {
    expect(serviceBay({ status: "error" })).toEqual({
      status: BAY_UNLOADED,
      figure: { label: "运行 / 停止", value: "—" },
    });
  });

  it("运行数取 STARTED、停止数取 STOPPED，存在异常时标记需要关注", () => {
    const model = serviceBay({
      status: "ready",
      services: [
        service("a", "STARTED"),
        service("b", "STARTED"),
        service("c", "STOPPED"),
        service("d", "ERROR"),
      ],
    });
    expect(model.figure).toEqual({ label: "运行 / 停止", value: "2 / 1" });
    expect(model.status).toEqual({ tone: "danger", label: "1 项异常", attention: true });
  });

  it("无异常时显示正常且不标记关注，空列表显示暂无服务", () => {
    expect(
      serviceBay({ status: "ready", services: [service("a", "STARTED"), service("b", "STOPPED")] })
        .status,
    ).toEqual({ tone: "success", label: "正常", attention: false });
    expect(serviceBay({ status: "ready", services: [] }).status).toEqual({
      tone: "neutral",
      label: "暂无服务",
      attention: false,
    });
  });
});

describe("OVERVIEW_MODULE_BAYS", () => {
  it("四个模块舱位按固定顺序排列，且导航目标都是已注册的路由", () => {
    const routeIds = OVERVIEW_MODULE_BAYS.map((bay) => bay.routeId);
    expect(routeIds).toEqual(["caddy", "environment", "aiConfig", "appConfig"]);
    const registered = APP_ROUTES.map((route) => route.id);
    for (const routeId of routeIds) expect(registered).toContain(routeId);
  });

  it("每个舱位的主操作文字都写明模块名，而不是只用图标或泛化的“进入”", () => {
    for (const bay of OVERVIEW_MODULE_BAYS) {
      expect(bay.action.startsWith("打开")).toBe(true);
      expect(bay.action).toContain(bay.title);
    }
  });
});

describe("ModuleBay", () => {
  const bay = OVERVIEW_MODULE_BAYS[0];

  it("未读取的舱位显示未读取、一个关键数字行与可见文字的主操作", () => {
    const markup = renderToStaticMarkup(
      <ModuleBay
        actionLabel={bay.action}
        figure={{ label: bay.figureLabel, value: "—" }}
        id="overview-bay-test"
        onOpen={() => undefined}
        status={BAY_UNLOADED}
        title={bay.title}
      />,
    );
    expect(markup).toContain("未读取");
    expect(markup).toContain(bay.figureLabel);
    expect(markup).toMatch(/<button[^>]*>打开 Caddy<\/button>/);
    expect(markup).toContain('aria-labelledby="overview-bay-test-heading"');
    expect(markup).not.toMatch(/status-glyph--(danger|warning|success)/);
    expect(markup).toContain("status-glyph--neutral");
  });

  it("未读取且提供读取回调时，读取摘要排在打开按钮之前", () => {
    const markup = renderToStaticMarkup(
      <ModuleBay
        actionLabel={bay.action}
        figure={{ label: bay.figureLabel, value: "—" }}
        id="overview-bay-test"
        onOpen={() => undefined}
        onRead={() => undefined}
        status={BAY_UNLOADED}
        title={bay.title}
      />,
    );
    expect(markup.indexOf("读取摘要")).toBeGreaterThan(-1);
    expect(markup.indexOf("读取摘要")).toBeLessThan(markup.indexOf("打开 Caddy"));
  });

  it("窄窗口为单列，宽窗口为 2 列与 3 列，且卡片等高", () => {
    const css = readFileSync(join(srcRoot, "styles", "global.css"), "utf8");
    expect(css).toMatch(/\.dashboard-workspace \.overview-bay-wall \{\s*min-width: 0;\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(min-width: 720px\) \{\s*\.dashboard-workspace \.overview-bay-wall \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(min-width: 1080px\) \{\s*\.dashboard-workspace \.overview-bay-wall \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.dashboard-workspace \.overview-bay \{[^}]*height: 100%;/);
  });


  it("需要关注的舱位才带状态点", () => {
    const markup = renderToStaticMarkup(
      <ModuleBay
        actionLabel="打开服务"
        figure={{ label: "运行 / 停止", value: "2 / 1" }}
        id="overview-bay-services"
        onOpen={() => undefined}
        status={{ tone: "danger", label: "1 项异常", attention: true }}
        title="服务"
      />,
    );
    expect(markup).toContain("status-glyph--danger");
    expect(markup).toContain("1 项异常");
  });

  it("主操作把点击交给 onOpen", () => {
    const onOpen = vi.fn();
    const element = ModuleBay({
      actionLabel: bay.action,
      figure: { label: bay.figureLabel, value: "—" },
      id: "overview-bay-test",
      onOpen,
      status: BAY_UNLOADED,
      title: bay.title,
    });
    const button = findButton(element);
    expect(button).toBeDefined();
    const onClick = button?.props.onClick as (() => void) | undefined;
    onClick?.();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
