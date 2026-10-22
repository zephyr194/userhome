import { describe, expect, it } from "vitest";
import { createScrollMemory } from "./pageScrollMemory";

describe("页面滚动记忆", () => {
  it("切换视图前后各自恢复自己的滚动位置", () => {
    const memory = createScrollMemory("compact");
    memory.record(300);
    expect(memory.switchTo("board")).toBe(0);
    memory.record(120);
    expect(memory.switchTo("compact")).toBe(300);
    expect(memory.switchTo("board")).toBe(120);
  });

  it("同一视图重复切换保持当前位置", () => {
    const memory = createScrollMemory("compact");
    memory.record(64);
    expect(memory.switchTo("compact")).toBe(64);
  });

  it("没有记录过的视图从顶部开始", () => {
    const memory = createScrollMemory("compact");
    expect(memory.switchTo("board")).toBe(0);
  });
});
