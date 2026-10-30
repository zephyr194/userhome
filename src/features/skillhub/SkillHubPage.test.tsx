// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SkillHubPage } from "./SkillHubPage";

describe("SKILLHUB 页面", () => {
  afterEach(cleanup);

  it("渲染只读说明、四个来源标签与全部 123 条目", () => {
    const html = renderToStaticMarkup(<SkillHubPage />);
    expect(html).toContain("只读目录");
    expect(html).toContain("共 123 条");
    expect(html).not.toMatch(/<h1[\s>]/);
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });

  it("点击来源标签后只显示该来源，并显示来源定位", () => {
    render(<SkillHubPage />);
    fireEvent.click(screen.getByRole("tab", { name: "pstack" }));
    expect(screen.getByText("共 61 条")).toBeTruthy();
    expect(screen.getByText("定位：严谨的工程执行、问题调查、多 Agent 验证")).toBeTruthy();
    expect(screen.getByText("入口：唯一入口 /poteto-mode，自动选择 Playbook")).toBeTruthy();
  });

  it("搜索框实时过滤，无结果时显示空状态", () => {
    render(<SkillHubPage />);
    const search = screen.getByRole("searchbox", { name: "搜索 Skill" });
    fireEvent.change(search, { target: { value: "using-agent-skills" } });
    expect(screen.getByText("共 1 条")).toBeTruthy();
    fireEvent.change(search, { target: { value: "没有这样的 skill" } });
    expect(screen.getByText("没有匹配的 Skill。")).toBeTruthy();
  });

  it("调用类型按钮切换 aria-pressed，并与搜索组合", () => {
    render(<SkillHubPage />);
    const group = screen.getByRole("group", { name: "调用类型" });
    const kindButton = within(group).getByRole("button", { name: "主动调用" });
    fireEvent.click(kindButton);
    expect(kindButton.getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "全部类型" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("共 16 条")).toBeTruthy();
  });
});
