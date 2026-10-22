// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionTabs } from "./SectionTabs";

const SECTIONS = [
  { id: "rules", label: "站点规则" },
  { id: "run", label: "运行" },
  { id: "raw", label: "原文 Caddyfile" },
];

afterEach(cleanup);

describe("SectionTabs", () => {
  it("renders one tab per section and marks only the selected one current", () => {
    const markup = renderToStaticMarkup(
      <SectionTabs label="Caddy 分区" sections={SECTIONS} selected="run" onSelect={() => undefined} />,
    );
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/aria-current=/g)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*aria-current="true"[^>]*>运行<\/button>/);
    const runTag = markup.match(/<[a-z]+[^>]*data-section-id="run"[^>]*>/)?.[0] ?? "";
    expect(runTag).toContain('aria-selected="true"');
  });

  it("exposes the section id on each tab and the label on the tab list", () => {
    const markup = renderToStaticMarkup(
      <SectionTabs label="Caddy 分区" sections={SECTIONS} selected="rules" onSelect={() => undefined} />,
    );
    for (const { id } of SECTIONS) {
      expect(markup).toContain(`data-section-id="${id}"`);
    }
    const tablist = markup.match(/<[a-z]+[^>]*role="tablist"[^>]*>/)?.[0] ?? "";
    expect(tablist).toContain('aria-label="Caddy 分区"');
    expect(tablist).toContain('data-slide-axis="x"');
    expect(tablist).toContain("slide-list");
  });

  it("calls onSelect with the id of the clicked tab", () => {
    const onSelect = vi.fn();
    render(
      <SectionTabs label="Caddy 分区" sections={SECTIONS} selected="rules" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "原文 Caddyfile" }));
    expect(onSelect).toHaveBeenCalledWith("raw");
  });
});
