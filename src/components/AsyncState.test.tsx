import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsyncState } from "./AsyncState";

describe("AsyncState", () => {
  it("announces loading and error states with the correct semantics", () => {
    const loading = renderToStaticMarkup(
      <AsyncState kind="loading">正在加载…</AsyncState>,
    );
    const error = renderToStaticMarkup(
      <AsyncState kind="error">加载失败。</AsyncState>,
    );

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
    expect(error).toContain('aria-live="assertive"');
  });

  it("uses body typography and never hides shared content", () => {
    const markup = renderToStaticMarkup(
      <AsyncState kind="partial">部分数据可用。</AsyncState>,
    );

    expect(markup).toContain("text-body");
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });

  it("renders the action inside the box, below the body on the same left edge", () => {
    const markup = renderToStaticMarkup(
      <AsyncState kind="error" action={<button type="button">重试</button>}>
        加载失败。
      </AsyncState>,
    );

    expect(markup).toMatch(
      /^<div[^>]*role="alert"[^>]*>.*加载失败。<div class="mt-ui-8"><button type="button">重试<\/button><\/div><\/div>$/,
    );
  });

  it("puts the error or warning prefix on its own block line", () => {
    const error = renderToStaticMarkup(
      <AsyncState kind="error">加载失败。</AsyncState>,
    );
    const partial = renderToStaticMarkup(
      <AsyncState kind="partial">部分数据可用。</AsyncState>,
    );

    expect(error).toMatch(/<strong class="block">[^<]+<\/strong>/);
    expect(partial).toMatch(/<strong class="block">[^<]+<\/strong>/);
    expect(error).not.toContain("mr-ui-8");
  });

  it("keeps the filled colour block and adds no action wrapper without an action", () => {
    const error = renderToStaticMarkup(
      <AsyncState kind="error">加载失败。</AsyncState>,
    );

    expect(error).toContain("bg-danger-soft text-danger");
    expect(error.match(/<div/g)).toHaveLength(1);
    expect(error).not.toContain("mt-ui-8");
  });

  it("drops the rounded corners only when flush is set", () => {
    const flush = renderToStaticMarkup(
      <AsyncState kind="error" flush>
        加载失败。
      </AsyncState>,
    );
    const boxed = renderToStaticMarkup(
      <AsyncState kind="error">加载失败。</AsyncState>,
    );

    expect(flush).not.toContain("rounded-control");
    expect(boxed).toContain("mt-ui-16 rounded-control px-ui-12");
  });

  it("appends the caller class after the state classes", () => {
    const markup = renderToStaticMarkup(
      <AsyncState kind="error" className="extra-marker">
        加载失败。
      </AsyncState>,
    );

    expect(markup).toMatch(/class="[^"]*bg-danger-soft text-danger extra-marker"/);
  });
});
