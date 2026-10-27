import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsyncState } from "../AsyncState";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders 2 or 3 bars and is hidden from assistive technology", () => {
    const two = renderToStaticMarkup(<Skeleton bars={2} />);
    const three = renderToStaticMarkup(<Skeleton />);
    expect(two).toContain('aria-hidden="true"');
    expect(two.match(/<span/g)).toHaveLength(2);
    expect(three.match(/<span/g)).toHaveLength(3);
  });
});

describe("AsyncState loading with skeleton", () => {
  it("keeps the text, role and aria-busy while adding a hidden skeleton", () => {
    const markup = renderToStaticMarkup(<AsyncState kind="loading">正在加载…</AsyncState>);
    expect(markup).toContain("正在加载…");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("motion-skeleton");
  });

  it("renders no skeleton for non-loading states", () => {
    const markup = renderToStaticMarkup(<AsyncState kind="empty">没有数据。</AsyncState>);
    expect(markup).not.toContain("motion-skeleton");
  });
});
