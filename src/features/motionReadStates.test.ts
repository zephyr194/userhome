/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("读取状态的动效接入", () => {
  it("概览四格的数值与状态在数据到达时淡入", () => {
    const dashboard = source("./dashboard/DashboardPage.tsx");
    expect(dashboard).toContain("ov-fact__figure motion-enter");
    expect(dashboard).toContain("ov-fact__status motion-enter");
  });

  it("AI 工具列表到达后淡入，占位保持四行骨架", () => {
    const aiView = source("./ai-config/AiConfigView.tsx");
    expect(aiView).toContain("motion-enter slide-list");
    expect(aiView).toContain("ai-tool-skeleton");
  });

  it("服务列表读取中使用骨架并保留 aria-busy，到达后淡入", () => {
    const servicesView = source("./services/ServicesView.tsx");
    expect(servicesView).toContain('<div aria-busy="true">');
    expect(servicesView).toContain('className="motion-skeleton--list"');
    expect(source("./services/ServiceGroups.tsx")).toContain("services-groups motion-enter");
  });

  it("应用配置列表读取中显示骨架，到达后淡入", () => {
    const appConfig = source("./app-config/AppConfigView.tsx");
    expect(appConfig).toContain('list.status === "loading" ? <Skeleton');
    expect(appConfig).toContain('<div className="motion-enter">');
  });
});
