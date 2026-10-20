import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServiceDetails as ServiceDetailsValue } from "../../ipc/services";
import { ServiceActionDialog } from "./ServiceActionDialog";
import { ServiceDetails } from "./ServiceDetails";
import { ServicesPage } from "./ServicesPage";

const LONG_NAME =
  "com.example.very-long-service-name-that-must-wrap-everywhere-avoiding-clipping-0123456789";
const LONG_METADATA =
  "/opt/homebrew/opt/very-long-package-name/libexec/another/very/long/path/that/keeps/going";
const LONG_ERROR =
  "服务操作失败：无法读取 launchd plist，目标路径 /opt/homebrew/Cellar/very-long-name/1.2.3/bin/run 不可访问，请检查权限后重试。";

function details(
  overrides: Partial<ServiceDetailsValue> = {},
): ServiceDetailsValue {
  return {
    serviceId: "caddy",
    displayName: "Caddy",
    state: "STARTED",
    status: "started",
    scope: "USER",
    manageable: true,
    configValidity: "VALID",
    ...overrides,
  };
}

describe("Services workspace structure (T121)", () => {
  it("renders a single heading and no duplicate page hero", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);

    // The shell owns the page h1; the workspace must not add another one.
    expect(markup.match(/<h1/g) ?? []).toHaveLength(0);
    // Exactly one primary heading level labels the list/detail workspace.
    expect(markup.match(/<h2/g) ?? []).toHaveLength(1);
    expect(markup).toContain('id="services-heading"');
    expect(markup).toContain('<h2 class="text-sm font-semibold"');
    expect(markup).toContain(">服务清单</h2>");
    expect(markup).toContain('aria-labelledby="services-heading"');

    // The old page hero copy is gone.
    expect(markup).not.toContain("Homebrew 服务管理");
    expect(markup).not.toContain("Homebrew 用户级与系统级服务");
  });

  it("keeps the inventory and detail panes distinct and labelled", () => {
    const markup = renderToStaticMarkup(
      <ServicesPage initialSelectedServiceId="caddy" />,
    );

    expect(markup).toContain('type="search"');
    expect(markup).toContain("按 label、名称或路径搜索");
    expect(markup).toContain('aria-label="任务详情"');
    expect(markup).toContain("正在加载服务详情");
  });

  it("keeps the detail pane read-only without operation history", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);

    expect(markup).not.toContain("正在加载操作历史");
    expect(markup).not.toContain("最近操作");
    expect(markup).toContain('aria-label="任务详情"');
  });

  it("keeps runtime state, config validity and manageability independent", () => {
    const markup = renderToStaticMarkup(
      <ServiceDetails
        details={details({ configValidity: "INVALID" })}
        onAction={() => {}}
      />,
    );

    expect(markup).toContain("运行状态");
    expect(markup).toContain("运行中");
    expect(markup).toContain("配置有效性");
    expect(markup).toContain("无效");
    expect(markup).toContain("Caddyfile");
    expect(markup).toContain('id="service-details-heading"');
    // Managable user service keeps its actions.
    expect(markup).toContain(">启动<");
  });

  it("renders unknown and unauthorized system services read-only", () => {
    for (const candidate of [
      details({ scope: "UNKNOWN", state: "UNKNOWN", manageable: false }),
      details({ scope: "SYSTEM", manageable: false }),
    ]) {
      const markup = renderToStaticMarkup(
        <ServiceDetails details={candidate} onAction={() => {}} />,
      );
      expect(markup).toContain("仅供查看");
      expect(markup).not.toContain(">启动<");
      expect(markup).not.toContain(">停止<");
      expect(markup).not.toContain(">重启<");
      expect(markup).toContain("只读");
    }
  });

  it("does not truncate long service metadata in the detail pane", () => {
    const markup = renderToStaticMarkup(
      <ServiceDetails
        details={details({
          displayName: LONG_NAME,
          serviceId: LONG_NAME,
          packageVersion: LONG_METADATA,
          user: LONG_METADATA,
          configIssue: LONG_ERROR,
        })}
        onAction={() => {}}
      />,
    );

    expect(markup).not.toContain("truncate");
    expect(markup).toContain(LONG_NAME);
    expect(markup).toContain(LONG_METADATA);
    expect(markup).toContain(LONG_ERROR);
  });

  it("does not truncate long operation results or errors", () => {
    const markup = renderToStaticMarkup(
      <ServiceActionDialog
        action="RESTART"
        preview={{
          operationId: "restart-caddy",
          summary: LONG_NAME,
          effects: [LONG_METADATA],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        }}
        serviceId={LONG_NAME}
        error={{ code: "PROCESS_FAILED", message: LONG_ERROR, retryable: false }}
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).not.toContain("truncate");
    expect(markup).toContain(LONG_NAME);
    expect(markup).toContain(LONG_METADATA);
    expect(markup).toContain(LONG_ERROR);
  });
});
