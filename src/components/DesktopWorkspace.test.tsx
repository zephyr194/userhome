import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesktopWorkspace } from "./DesktopWorkspace";

const baseProps = {
  detail: <div data-testid="detail-body">detail</div>,
  detailLabel: "内容",
  sidebar: <div data-testid="sidebar-body" />,
  toolbar: <div data-testid="toolbar-body" />,
};

describe("DesktopWorkspace", () => {
  it("hosts the route pane directly without a second scroll wrapper", () => {
    const markup = renderToStaticMarkup(<DesktopWorkspace {...baseProps} />);

    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup.match(/desktop-workspace__toolbar/g)).toHaveLength(1);
    expect(markup.match(/desktop-workspace__detail/g)).toHaveLength(1);
    // The route content is rendered straight into the detail host so the
    // route pane itself stays the only scroll owner.
    expect(markup).toContain(
      'class="desktop-workspace__detail min-w-0 min-h-0"',
    );
    expect(markup).toContain(
      '<section class="desktop-workspace__detail min-w-0 min-h-0" aria-label="内容"><div data-testid="detail-body">',
    );
  });

  it("bounds every pane without adding meaningless tab stops", () => {
    const markup = renderToStaticMarkup(
      <DesktopWorkspace
        {...baseProps}
        list={<div />}
        inspector={<div />}
        operationProgress={<div />}
      />,
    );

    expect(markup).toContain(
      'class="desktop-workspace__list min-w-0 min-h-0"',
    );
    expect(markup).toContain(
      'class="desktop-workspace__inspector min-w-0 min-h-0"',
    );
    expect(markup).toContain(
      'class="desktop-workspace__operation-progress min-w-0 min-h-0"',
    );
    expect(markup).not.toContain('tabindex="0"');
  });

  it("renders no shell hero", () => {
    const markup = renderToStaticMarkup(<DesktopWorkspace {...baseProps} />);

    expect(markup).not.toContain("interface-preview");
    expect(markup).not.toContain("welcome-panel");
  });

  it("draws notices as an overlay so the panes keep the same markup and position", () => {
    const withNotice = renderToStaticMarkup(
      <DesktopWorkspace {...baseProps} banner={<p role="alert">提示</p>} />,
    );
    const withoutNotice = renderToStaticMarkup(<DesktopWorkspace {...baseProps} />);
    const panesFrom = (markup: string) => markup.slice(markup.indexOf('class="desktop-workspace__panes'));

    expect(withNotice).toContain(
      'class="desktop-workspace__content"><div class="desktop-workspace__banner min-w-0 break-words" data-overlay="notices">',
    );
    expect(panesFrom(withNotice)).toBe(panesFrom(withoutNotice));
  });

  it("hides the overlay container when there is nothing to show", () => {
    const markup = renderToStaticMarkup(<DesktopWorkspace {...baseProps} />);

    expect(markup).toContain('data-overlay="notices" hidden=""');
  });
});
