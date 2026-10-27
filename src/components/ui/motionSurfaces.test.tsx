// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";

afterEach(() => {
  cleanup();
});

describe("Modal motion", () => {
  it("面板带 motion-dialog 与 data-closed 透明度变体", () => {
    render(
      <Modal onClose={() => undefined} open title="标题" titleId="motion-modal-title">
        <p>正文</p>
      </Modal>,
    );
    const panel = document.querySelector(".motion-dialog");
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("data-closed:opacity-0");
  });

  it("关闭后面板最终卸载（jsdom 没有动画事件，按卸载断言）", async () => {
    const { rerender } = render(
      <Modal onClose={() => undefined} open title="标题" titleId="motion-modal-close">
        <p>正文</p>
      </Modal>,
    );
    rerender(
      <Modal onClose={() => undefined} open={false} title="标题" titleId="motion-modal-close">
        <p>正文</p>
      </Modal>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
