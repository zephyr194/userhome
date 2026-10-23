import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("Modal server markup", () => {
  it("keeps the title outside the scrolling body on the server branch too", () => {
    const markup = renderToStaticMarkup(
      <Modal onClose={() => undefined} open title="配置标题" footer={<span>完成</span>}>
        <p>正文内容</p>
      </Modal>,
    );

    const titleWrapper = markup.match(/<div class="([^"]*)"><div class="min-w-0 break-words text-group font-semibold">配置标题/);
    expect(titleWrapper?.[1]).not.toContain("overflow-y-auto");
    expect(markup).toMatch(/<div class="min-h-0 flex-1 overflow-y-auto[^"]*"><p>正文内容<\/p>/);
  });
});
