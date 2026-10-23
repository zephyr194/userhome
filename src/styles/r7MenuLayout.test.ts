import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");

function block(name: string): string {
  const open = `/* ${name} `;
  const start = css.indexOf(open);
  const end = css.indexOf(`/* /${name.split(" ")[0]} */`, start);
  if (start < 0 || end < 0) throw new Error(`missing ${name} block`);
  return css.slice(start, end);
}

const menuBlock = block("r7-menu");

describe("r7-menu 样式区块", () => {
  it("新样式集中在 r7-menu 区块内，不改写 Panel 全局组件", () => {
    expect(menuBlock).toMatch(/\.borderless-pane \.rounded-panel\s*\{[^}]*box-shadow:\s*none/);
  });

  it("设置详情标题去掉底色与底边，内容区左右留白与标题对齐", () => {
    expect(menuBlock).toMatch(/\.borderless-pane \.settings-pane__detail-header\s*\{[^}]*background:\s*transparent/);
    expect(menuBlock).toMatch(/\.borderless-pane \.settings-pane__detail-header\s*\{[^}]*border-bottom(-width)?:\s*0/);
  });

  it("不加焦点外框、渐变、剪裁或大阴影", () => {
    expect(menuBlock).not.toMatch(/outline/);
    expect(menuBlock).not.toMatch(/gradient/);
    expect(menuBlock).not.toMatch(/clip-path/);
    expect(menuBlock).not.toMatch(/box-shadow:\s*(?!none\b)\S/);
  });

  it("设置行的说明不再带破折号前缀，说明靠右排布", () => {
    expect(css).not.toMatch(/\.settings-pane__tab-desc::before/);
  });
});
