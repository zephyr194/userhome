import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseIcon } from "./icons";
import { CloseButton, IconButton } from "./IconButton";

function attributeOf(markup: string, name: string): string | undefined {
  return markup.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
}

function classesOf(markup: string): string[] {
  const match = markup.match(/class="([^"]*)"/);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

describe("IconButton", () => {
  it("同时写入 aria-label 与 title，二者都是 label", () => {
    const markup = renderToStaticMarkup(
      <IconButton label="复制">
        <CloseIcon />
      </IconButton>,
    );
    expect(attributeOf(markup, "aria-label")).toBe("复制");
    expect(attributeOf(markup, "title")).toBe("复制");
  });

  it("固定 ghost 变体，宽与高取同一尺寸令牌，水平内边距归零", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const classes = classesOf(
        renderToStaticMarkup(
          <IconButton label="关闭" size={size}>
            <CloseIcon />
          </IconButton>,
        ),
      );
      expect(classes, size).toContain(`min-w-control-${size}`);
      expect(classes, size).toContain(`min-h-control-${size}`);
      expect(classes, size).toContain("bg-transparent");
      expect(classes, size).toContain("r16-icon-button");
    }
  });

  it("水平内边距归零的规则未分层，能压过 Tailwind 的 px-ui-8", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "global.css"), "utf8");
    expect(css).toMatch(/\.r16-icon-button\s*\{\s*padding-inline:\s*0;\s*\}/);
  });

  it("默认尺寸为 md", () => {
    const classes = classesOf(
      renderToStaticMarkup(
        <IconButton label="关闭">
          <CloseIcon />
        </IconButton>,
      ),
    );
    expect(classes).toContain("min-w-control-md");
    expect(classes).toContain("min-h-control-md");
  });

  it("缺少 label 时类型报错", () => {
    // @ts-expect-error label 为必填
    const element = <IconButton>{null}</IconButton>;
    expect(element).toBeTruthy();
  });
});

describe("CloseButton", () => {
  it("是带 14px ✕ 图标的 IconButton，aria-label 与 title 为 label", () => {
    const markup = renderToStaticMarkup(<CloseButton label="关闭通知" />);
    expect(attributeOf(markup, "aria-label")).toBe("关闭通知");
    expect(attributeOf(markup, "title")).toBe("关闭通知");
    expect(markup).toContain('width="14"');
    expect(markup).toContain('height="14"');
    expect(classesOf(markup)).toContain("bg-transparent");
  });

  it("缺少 label 时类型报错", () => {
    // @ts-expect-error label 为必填
    const element = <CloseButton />;
    expect(element).toBeTruthy();
  });
});

describe("CloseIcon", () => {
  it("隐藏于辅助技术，描边使用 currentColor 与 1.75 线宽", () => {
    const markup = renderToStaticMarkup(<CloseIcon />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.75"');
  });
});
