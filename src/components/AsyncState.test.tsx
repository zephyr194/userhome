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
});
