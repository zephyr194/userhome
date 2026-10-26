// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreSlideLayout, stubSlideLayout } from "../../components/ui/slideLayoutStub";
import { ToolsPage } from "./ToolsPage";

describe("ToolsPage 指示条", () => {
  beforeEach(() => {
    stubSlideLayout("x");
  });

  afterEach(() => {
    cleanup();
    restoreSlideLayout();
  });

  it("先选中右侧工具，再选中左侧工具时指示条立即移动到左侧", () => {
    const { container } = render(<ToolsPage />);
    const list = container.querySelector<HTMLElement>(".slide-list");
    fireEvent.click(screen.getByRole("tab", { name: "编解码" }));
    expect(list?.style.getPropertyValue("--slide-x")).toBe("200px");
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    expect(list?.style.getPropertyValue("--slide-x")).toBe("0px");
  });
});
