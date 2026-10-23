/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHELL = readFileSync(join(process.cwd(), "src", "app", "AppShell.tsx"), "utf8");

describe("AppShell 工具栏按钮尺寸", () => {
  it("工具栏 ActionRow 内每个按钮都显式声明同一个 size", () => {
    const row = SHELL.match(/<ActionRow>([\s\S]*?)<\/ActionRow>/)?.[1] ?? "";
    const buttons = row.match(/<Button\b/g)?.length ?? 0;
    const sizes = [...row.matchAll(/\bsize="(\w+)"/g)].map((match) => match[1]);
    expect(buttons).toBeGreaterThan(0);
    expect(sizes).toHaveLength(buttons);
    expect(new Set(sizes)).toEqual(new Set(["md"]));
  });
});
