import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvironmentPage } from "./EnvironmentPage";

describe("environment page sections", () => {
  const markup = renderToStaticMarkup(<EnvironmentPage />);

  it("offers the dotenv and zsh sections as tabs inside the page", () => {
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="环境配置分区"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain("dotenv 文件");
    expect(markup).toContain("zsh 启动文件");
  });

  it("opens on the dotenv section and does not read zsh files before the tab is opened", () => {
    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>dotenv 文件|aria-selected="true"[^>]*role="tab"[^>]*>dotenv 文件/);
    expect(markup).toContain("环境文件");
    expect(markup).not.toContain('aria-labelledby="zsh-heading"');
    expect(markup).not.toContain("正在读取 zsh 启动文件");
  });
});
