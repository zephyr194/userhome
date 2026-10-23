import { describe, expect, it } from "vitest";
import { editsProblem, zshEditProblem } from "./environment";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

describe("environment edit problems in English", () => {
  it("describes an empty key-level save in English", () => {
    expect(editsProblem([], "en")).toBe("A save needs 1 to 64 changes.");
    expect(editsProblem([], "zh-CN")).toBe("一次保存需要 1 到 64 项改动。");
  });

  it("describes a zsh variable problem in English without Chinese characters", () => {
    const problem = zshEditProblem({ variables: [{ op: "SET", name: "1BAD", value: "x" }] }, "en");
    expect(problem).toBeDefined();
    expect(CJK_PATTERN.test(problem ?? "")).toBe(false);
  });

  it("keeps zh-CN text when no locale is passed", () => {
    expect(zshEditProblem({ variables: [{ op: "SET", name: "1BAD", value: "x" }] })).toMatch(/变量名/);
  });
});
