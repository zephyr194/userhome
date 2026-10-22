import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionContext } from "../../app/SectionContext";
import { EnvironmentPage } from "./EnvironmentPage";

const noop = () => undefined;

function render(section?: string): string {
  return renderToStaticMarkup(
    <SectionContext.Provider value={section === undefined ? undefined : { section, select: noop }}>
      <EnvironmentPage />
    </SectionContext.Provider>,
  );
}

describe("environment page sections", () => {
  it("selects the zsh tab for the zsh section", () => {
    const markup = render("zsh");
    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>zsh 启动文件/);
    expect(markup).not.toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>dotenv 文件/);
  });

  it("selects the dotenv tab without a section or for the dotenv section", () => {
    for (const markup of [render(), render("dotenv")]) {
      expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>dotenv 文件/);
    }
  });
});
