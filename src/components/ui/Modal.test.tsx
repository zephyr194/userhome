// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  it("keeps the title and footer outside the scrolling body", () => {
    render(
      <Modal
        footer={<button type="button">完成</button>}
        onClose={() => undefined}
        open
        title="配置标题"
        titleId="modal-test-title"
      >
        <p>正文内容</p>
      </Modal>,
    );

    expect(screen.getByText("配置标题").closest(".overflow-y-auto")).toBeNull();
    expect(screen.getByRole("button", { name: "完成" }).closest(".overflow-y-auto")).toBeNull();

    const body = screen.getByText("正文内容").parentElement;
    expect(body?.classList.contains("overflow-y-auto")).toBe(true);
    expect(body?.classList.contains("min-h-0")).toBe(true);
  });
});
