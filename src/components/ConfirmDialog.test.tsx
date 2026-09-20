import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("exposes modal dialog semantics and a labelled heading", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        className="action-dialog"
        titleId="confirm-heading"
        onCancel={() => undefined}
      >
        <h2 id="confirm-heading">确认操作</h2>
        <button type="button">确认</button>
      </ConfirmDialog>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="confirm-heading"');
  });
});
