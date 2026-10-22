import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServicesPage } from "./ServicesPage";

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
    expect(markup).toContain("正在读取本机状态");
  });

  it("keeps the detail pane read-only without operation history", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);

    expect(markup).not.toContain("正在加载操作历史");
    expect(markup).not.toContain("最近操作");
    expect(markup).toContain('aria-label="任务详情"');
  });
});
