import { describe, expect, it } from "vitest";
import { shouldExitBoardOnEscape, type BoardEscapeTarget } from "./boardEscape";

const PLAIN_TARGET: BoardEscapeTarget = { matches: () => false };
const OWNING_TARGET: BoardEscapeTarget = { matches: () => true };
const ESCAPE = { key: "Escape", defaultPrevented: false };

describe("看板 Esc 返回规则", () => {
  it("普通页面上的 Esc 退出看板", () => {
    expect(shouldExitBoardOnEscape({ ...ESCAPE, target: PLAIN_TARGET }, false)).toBe(true);
  });

  it("没有焦点目标（null）时也退出看板", () => {
    expect(shouldExitBoardOnEscape({ ...ESCAPE, target: null }, false)).toBe(true);
  });

  it("其它按键不退出看板", () => {
    expect(
      shouldExitBoardOnEscape({ key: "Enter", defaultPrevented: false, target: PLAIN_TARGET }, false),
    ).toBe(false);
  });

  it("事件已被处理（defaultPrevented）时不退出", () => {
    expect(
      shouldExitBoardOnEscape({ key: "Escape", defaultPrevented: true, target: PLAIN_TARGET }, false),
    ).toBe(false);
  });

  it("页面有打开的对话框时不退出", () => {
    expect(shouldExitBoardOnEscape({ ...ESCAPE, target: PLAIN_TARGET }, true)).toBe(false);
  });

  it("焦点在会自行处理 Esc 的控件内（输入、展开态）时不退出", () => {
    expect(shouldExitBoardOnEscape({ ...ESCAPE, target: OWNING_TARGET }, false)).toBe(false);
  });
});
