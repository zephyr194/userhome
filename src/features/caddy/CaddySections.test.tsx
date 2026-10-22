import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionContext } from "../../app/SectionContext";
import { isTextVisible } from "../../test/markupVisibility";
import { CaddyPage } from "./CaddyPage";

const noop = () => undefined;

function render(section: string): string {
  return renderToStaticMarkup(
    <SectionContext.Provider value={{ section, select: noop }}>
      <CaddyPage />
    </SectionContext.Provider>,
  );
}

const RULES = "正在读取已保存的规则";
const RUN = "运行（自有实例）";
const RAW = "原文按原样保存和校验";
const WORKDIR = "Caddy 检测";

describe("Caddy page sections", () => {
  it("shows only the rules block in the rules section", () => {
    const markup = render("rules");
    expect(isTextVisible(markup, RULES)).toBe(true);
    expect(isTextVisible(markup, RUN)).toBe(false);
    expect(isTextVisible(markup, RAW)).toBe(false);
  });

  it("shows only the run block in the run section", () => {
    const markup = render("run");
    expect(isTextVisible(markup, RUN)).toBe(true);
    expect(isTextVisible(markup, RULES)).toBe(false);
    expect(isTextVisible(markup, RAW)).toBe(false);
  });

  it("shows only the raw editor in the raw section", () => {
    const markup = render("raw");
    expect(isTextVisible(markup, RAW)).toBe(true);
    expect(isTextVisible(markup, RULES)).toBe(false);
    expect(isTextVisible(markup, RUN)).toBe(false);
  });

  it("keeps the workdir and detect panels visible in every section", () => {
    for (const section of ["rules", "run", "raw"]) {
      expect(isTextVisible(render(section), WORKDIR), section).toBe(true);
    }
  });

  it("keeps every section mounted in the hidden state", () => {
    const markup = render("rules");
    expect(markup).toContain(RUN);
    expect(markup).toContain(RAW);
  });

  it("shows the three sections as tabs above the content with the selected one current", () => {
    const markup = render("run");
    expect(markup.match(/data-section-id="/g)).toHaveLength(3);
    const current = markup.match(/<[a-z]+[^>]*data-section-id="run"[^>]*>/)?.[0] ?? "";
    expect(current).toContain('aria-current="true"');
  });
});
