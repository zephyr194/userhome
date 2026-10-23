/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(join(srcRoot, "styles/global.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rulesFor(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").map((part) => part.trim()).includes(selector),
    )
    .map((match) => match[2]);
}

function declaredValues(selector: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return rulesFor(selector).flatMap((body) =>
    [...body.matchAll(pattern)].map((match) => match[1].trim()),
  );
}

describe("侧栏样式审计", () => {
  it("导航项的 ::before 不再绘制竖条（无任何规则）", () => {
    expect(rulesFor(".navigation-rail a::before")).toEqual([]);
  });

  it("导航项与当前项自身不画底色阴影或左侧边框，选中框只由 .slide-list 的 ::before 承担", () => {
    for (const selector of [
      ".navigation-rail a",
      '.navigation-rail a[aria-current="page"]',
      ".navigation-rail .slide-item",
    ]) {
      expect(declaredValues(selector, "box-shadow"), selector).toEqual([]);
      expect(declaredValues(selector, "border-left"), selector).toEqual([]);
      expect(declaredValues(selector, "border-inline-start"), selector).toEqual([]);
    }
  });

  it("侧栏自身是唯一的纵向滚动容器，分组列表不再各自滚动或伸缩", () => {
    const railOverflow = declaredValues(".navigation-rail", "overflow-y");
    expect(railOverflow[railOverflow.length - 1]).toBe("auto");
    expect(declaredValues(".navigation-rail ul", "overflow-y")).toEqual([]);
    expect(declaredValues(".navigation-rail ul", "flex")).toEqual([]);
  });

  it("侧栏容器是指示器的定位上下文", () => {
    expect(declaredValues(".slide-list", "position")).toContain("relative");
  });

  it("分组标题为 11px 的 muted 小字，不全大写、不加字距，且不参与定位（不打断选中框测量）", () => {
    const label = ".navigation-rail__section-label";
    expect(declaredValues(label, "font-size")).toEqual(["var(--app-font-size-meta)"]);
    expect(declaredValues(label, "color")).toEqual(["var(--app-muted-foreground)"]);
    expect(declaredValues(label, "text-transform")).toEqual([]);
    expect(declaredValues(label, "letter-spacing")).toEqual([]);
    expect(declaredValues(label, "position")).toEqual(["absolute"]);
    expect(declaredValues(".navigation-rail ul", "position")).toEqual([]);
  });
});
