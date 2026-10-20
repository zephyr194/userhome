import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServicesPage } from "./ServicesPage";
import { ServicesView } from "./ServicesView";
import { EMPTY_FILTER } from "./launchdModel";

describe("create entry on the services page", () => {
  it("offers the creation entry beside refresh and keeps the dialog closed", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);
    expect(markup).toContain("创建自建任务");
    expect(markup).toContain("刷新");
    expect(markup).not.toContain("创建 UserHome 自建任务");
    expect(markup).not.toContain('role="dialog"');
    // The discovered tasks stay read-only.
    expect(markup).toContain("只读");
  });

  it("renders the view without any extra control unless the page supplies one", () => {
    const props = {
      state: { status: "loading" as const },
      evidence: { status: "loading" as const },
      filter: EMPTY_FILTER,
      selectedId: undefined,
      refreshDisabled: false,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onRefresh: () => undefined,
    };
    const plain = renderToStaticMarkup(<ServicesView {...props} />);
    expect(plain).not.toContain("创建自建任务");
    const withAction = renderToStaticMarkup(
      <ServicesView {...props} headerActions={<span>额外入口</span>} />,
    );
    expect(withAction).toContain("额外入口");
  });
});
