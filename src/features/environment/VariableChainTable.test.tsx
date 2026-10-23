// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariableChainTable } from "./VariableChainTable";
import type { VariableChainRow } from "./variableChainModel";

afterEach(() => cleanup());

const ROWS: VariableChainRow[] = [
  {
    name: "ZED",
    final: { value: { kind: "text", text: "last" }, source: { file: ".zshrc", line: 9 } },
    chain: [],
  },
  {
    name: "EDITOR",
    final: {
      value: { kind: "text", text: "code" },
      source: { file: ".zlogin", line: 3 },
      scope: "LOGIN",
    },
    chain: [
      { value: { kind: "text", text: "vim" }, source: { file: ".zprofile", line: 1 }, scope: "ALL" },
      { value: { kind: "masked" }, source: { file: ".zshenv", line: 2 }, scope: "ALL" },
    ],
    note: "可能被后面的文件覆盖",
  },
  {
    name: "GITHUB_TOKEN",
    final: { value: { kind: "masked" }, source: { file: ".zshrc", line: 5 }, scope: "INTERACTIVE" },
    chain: [{ value: { kind: "masked" }, source: { file: ".zprofile", line: 4 } }],
  },
];

function renderTable(overrides: { onEdit?: (row: VariableChainRow) => void } = {}) {
  const onRevealFinal = vi.fn(() => Promise.resolve("plain-final"));
  render(
    <VariableChainTable
      label="变量"
      onRevealFinal={onRevealFinal}
      rows={ROWS}
      {...overrides}
    />,
  );
  return { onRevealFinal };
}

function rowNames(): string[] {
  return within(screen.getByRole("table", { name: "变量" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("code")?.textContent ?? "");
}

describe("variable chain table layout", () => {
  it("lists one row per name in alphabetical order, under a fixed header", () => {
    renderTable();
    expect(rowNames()).toEqual(["EDITOR", "GITHUB_TOKEN", "ZED"]);
    const header = screen.getByRole("table", { name: "变量" }).querySelector("thead");
    expect(header?.className).toContain("sticky");
    expect(header?.textContent).toContain("变量名");
    expect(header?.textContent).toContain("最终值");
    expect(header?.textContent).toContain("来源");
    expect(header?.textContent).toContain("过程值");
  });

  it("shows the source as file and line, and the scope as a text badge", () => {
    renderTable();
    expect(screen.getByText(".zlogin:3")).toBeTruthy();
    expect(screen.getByText("仅登录 shell")).toBeTruthy();
  });

  it("shows the process value count only where there is an earlier assignment", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "过程值 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "过程值 1" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /过程值/ })).toHaveLength(2);
  });

  it("shows the overridden note as text, not only as colour", () => {
    renderTable();
    expect(screen.getByText("可能被后面的文件覆盖")).toBeTruthy();
  });
});

describe("expanding the reading chain", () => {
  it("lists earlier assignments in reading order and marks the final one with a 最终 badge", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "过程值 2" }));
    const steps = within(screen.getByRole("list", { name: "EDITOR 的读取顺序" })).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain("vim");
    expect(steps[0]?.textContent).toContain(".zprofile:1");
    expect(steps[2]?.textContent).toContain("最终");
    expect(steps[2]?.textContent).toContain(".zlogin:3");
    expect(steps[2]?.className).toContain("border-primary");
    expect(steps[2]?.textContent).not.toContain("过程值");
    expect(screen.getByRole("button", { name: "过程值 2" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses again on a second click", () => {
    renderTable();
    const toggle = screen.getByRole("button", { name: "过程值 2" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole("list", { name: "EDITOR 的读取顺序" })).toBeNull();
  });
});

describe("secrets", () => {
  it("masks a secret process value and offers no reveal control for it", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "过程值 2" }));
    const steps = within(screen.getByRole("list", { name: "EDITOR 的读取顺序" })).getAllByRole("listitem");
    expect(steps[1]?.textContent).toContain("秘密，过程值不显示");
    expect(steps[1]?.querySelector("button")).toBeNull();
  });

  it("offers reveal only for the final value of a secret, through the existing load control", () => {
    const { onRevealFinal } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "过程值 1" }));
    const load = screen.getByRole("button", { name: "载入 GITHUB_TOKEN 的值" });
    expect(load).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /载入/ })).toHaveLength(1);
    fireEvent.click(load);
    expect(onRevealFinal).toHaveBeenCalledWith(ROWS[2]);
  });

  it("shows the 秘密 badge on a row whose final value is masked", () => {
    renderTable();
    const token = within(screen.getByRole("table", { name: "变量" }))
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("GITHUB_TOKEN"));
    expect(token?.textContent).toContain("秘密");
  });
});

describe("editing", () => {
  it("opens the assignment a row's final value comes from", () => {
    const onEdit = vi.fn();
    renderTable({ onEdit });
    fireEvent.click(screen.getByRole("button", { name: "修改 EDITOR" }));
    expect(onEdit).toHaveBeenCalledWith(ROWS[1]);
  });

  it("is read only without an edit handler", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /修改/ })).toBeNull();
  });
});
