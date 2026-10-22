import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BoardViewContext,
  type BoardViewContextValue,
} from "../../app/BoardViewContext";
import { BoardToggle } from "./BoardToggle";
import { BoardToggle as BoardToggleFromIndex } from "./index";

const noop = () => undefined;

function value(overrides: Partial<BoardViewContextValue>): BoardViewContextValue {
  return {
    available: true,
    view: "compact",
    isBoard: false,
    enter: noop,
    exit: noop,
    toggle: noop,
    ...overrides,
  };
}

function render(contextValue: BoardViewContextValue) {
  return renderToStaticMarkup(
    <BoardViewContext.Provider value={contextValue}>
      <BoardToggle />
    </BoardViewContext.Provider>,
  );
}

describe("BoardToggle", () => {
  it("紧凑态显示“看板”，图标装饰化，未按下", () => {
    const markup = render(value({ view: "compact", isBoard: false }));
    expect(markup).toContain("看板");
    expect(markup).not.toContain("退出看板");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('<span aria-hidden="true">▣</span>');
  });

  it("看板态显示“退出看板”，按下", () => {
    const markup = render(value({ view: "board", isBoard: true }));
    expect(markup).toContain("退出看板");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("使用 md 控件高度令牌的按钮", () => {
    const markup = render(value({}));
    expect(markup).toContain("<button");
    expect(markup).toContain("min-h-control-md");
  });

  it("路由不支持看板时不渲染任何内容", () => {
    expect(render(value({ available: false }))).toBe("");
  });

  it("未提供上下文时默认不渲染", () => {
    expect(renderToStaticMarkup(<BoardToggle />)).toBe("");
  });

  it("ui 索引导出 BoardToggle", () => {
    expect(BoardToggleFromIndex).toBe(BoardToggle);
  });
});
