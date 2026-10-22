import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardViewContext, type BoardViewContextValue } from "../../app/BoardViewContext";
import { SectionContext } from "../../app/SectionContext";
import { EnvironmentPage } from "./EnvironmentPage";

const noop = () => undefined;

const COMPACT: BoardViewContextValue = {
  available: true,
  view: "compact",
  isBoard: false,
  enter: noop,
  exit: noop,
  toggle: noop,
};

function render(section?: string): string {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={COMPACT}>
      <SectionContext.Provider value={section === undefined ? undefined : { section, select: noop }}>
        <EnvironmentPage />
      </SectionContext.Provider>
    </BoardViewContext.Provider>,
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
