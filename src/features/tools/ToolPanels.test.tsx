/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolsPage } from "./ToolsPage";

const toolsDir = fileURLToPath(new URL(".", import.meta.url));
const PANEL_FILES = ["JsonTool.tsx", "XmlTool.tsx", "CodecTool.tsx", "QrTool.tsx"];

describe("工具面板外框与说明（r4-fe5）", () => {
  it.each(PANEL_FILES)("%s 只用 Panel 自带的 1px 外框", (file) => {
    const source = readFileSync(join(toolsDir, file), "utf8");
    expect(source).not.toContain("border border-border");
  });

  it("标签下方不再重复一句工具摘要，说明只留在面板内", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    expect(html).not.toContain("严格校验与格式化，保留数字与重复键原文。");
    expect(html).toContain("严格 JSON 校验；数字、字符串与重复键保留原文，只调整空白。");
  });
});
