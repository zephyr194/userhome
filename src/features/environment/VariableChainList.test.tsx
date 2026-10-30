// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VariableChainList } from "./VariableChainList";
import type { VariableChainRow } from "./variableChainModel";
import { forgetQueries } from "./variableSearch";

const SECRET = "s3cret-value-do-not-leak";

afterEach(() => cleanup());
beforeEach(() => forgetQueries());

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

function renderList(
  overrides: Partial<Parameters<typeof VariableChainList>[0]> = {},
  rows: readonly VariableChainRow[] = ROWS,
) {
  const onRevealFinal = vi.fn(() => Promise.resolve(SECRET));
  const props = {
    label: "变量",
    onRevealFinal,
    rows,
    searchKey: "list-test",
    ...overrides,
  };
  render(<VariableChainList {...props} />);
  return { onRevealFinal };
}

function list(): HTMLElement {
  return screen.getByRole("region", { name: "变量" });
}

function detail(): HTMLElement {
  return screen.getByRole("region", { name: "选中变量的详情" });
}

function pick(name: string) {
  fireEvent.click(within(list()).getByRole("button", { name: new RegExp(`^${name}\\b`) }));
}

function names(): string[] {
  return within(list())
    .getAllByRole("button")
    .map((button) => button.querySelector("code")?.textContent ?? "");
}

describe("variable list and selected detail", () => {
  it("lists names alphabetically and shows the first name's detail by default", () => {
    renderList();
    expect(names()).toEqual(["EDITOR", "GITHUB_TOKEN", "ZED"]);
    expect(within(detail()).getByRole("heading", { level: 3 }).textContent).toBe("EDITOR");
    expect(within(list()).getByRole("button", { name: /^EDITOR\b/ }).getAttribute("aria-current")).toBe("true");
  });

  it("switches the detail and moves aria-current when another name is picked", () => {
    renderList();
    pick("ZED");
    expect(within(detail()).getByRole("heading", { level: 3 }).textContent).toBe("ZED");
    expect(within(list()).getByRole("button", { name: /^ZED\b/ }).getAttribute("aria-current")).toBe("true");
    expect(within(list()).getByRole("button", { name: /^EDITOR\b/ }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the final value and its source, and the earlier values in reading order", () => {
    renderList();
    expect(within(detail()).getByText("code")).toBeTruthy();
    expect(within(detail()).getByText(".zlogin:3")).toBeTruthy();
    const steps = within(within(detail()).getByRole("list", { name: "EDITOR 的读取顺序" })).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]?.textContent).toContain("vim");
    expect(steps[0]?.textContent).toContain(".zprofile:1");
    expect(within(detail()).getByText("可能被后面的文件覆盖")).toBeTruthy();
  });

  it("keeps a secret masked until it is loaded, and loads it only on click", () => {
    const { onRevealFinal } = renderList();
    pick("GITHUB_TOKEN");
    expect(onRevealFinal).not.toHaveBeenCalled();
    expect(detail().textContent).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: "载入 GITHUB_TOKEN 的值" }));
    expect(onRevealFinal).toHaveBeenCalledTimes(1);
    expect(onRevealFinal).toHaveBeenCalledWith(expect.objectContaining({ name: "GITHUB_TOKEN" }));
  });

  it("shows the expanded value as the final value, with the written value noted", () => {
    renderList({}, [
      {
        name: "BIN",
        final: {
          value: { kind: "text", text: "$BASE/bin" },
          source: { file: ".zshrc", line: 4 },
          state: "REFERENCE",
          effective: { kind: "text", text: "/opt/bin" },
        },
        chain: [{ value: { kind: "text", text: "/opt" }, source: { file: ".zshenv", line: 1 } }],
      },
    ]);
    expect(within(detail()).getByText("/opt/bin")).toBeTruthy();
    expect(detail().textContent).toContain("由原文 $BASE/bin 展开得到");
  });

  it.each([
    [
      "a reference with no earlier assignment",
      { kind: "unresolved", reason: "reference", names: ["HOME"] },
      "引用的 HOME 在它之前没有可确定的赋值",
    ],
    [
      "a secret or long value it refers to",
      { kind: "unresolved", reason: "hidden", names: ["TOKEN"] },
      "引用的 TOKEN 是秘密或长值，不展开",
    ],
    [
      "a run-time value",
      { kind: "unresolved", reason: "dynamic", names: ["NOW"] },
      "值在运行时才确定，无法静态算出",
    ],
    [
      "an appending assignment",
      { kind: "unresolved", reason: "append", names: [] },
      "追加赋值的结果取决于 shell",
    ],
    [
      "a form that is not expanded",
      { kind: "unresolved", reason: "complex", names: [] },
      "包含不支持静态展开的写法",
    ],
  ] as const)("explains %s and still shows the written value", (_case, effective, message) => {
    renderList({}, [
      {
        name: "BIN",
        final: {
          value: { kind: "text", text: "$HOME/bin" },
          source: { file: ".zshrc", line: 4 },
          state: "REFERENCE",
          effective,
        },
        chain: [],
      },
    ]);
    expect(detail().textContent).toContain(message);
    expect(within(detail()).getByText("$HOME/bin")).toBeTruthy();
  });

  it("shows a merged name with the merged note and each file's value, and no final value", () => {
    renderList({}, [
      {
        name: "API_URL",
        final: { value: { kind: "text", text: "a" }, source: { file: "a.env", line: 1 } },
        chain: [
          { value: { kind: "text", text: "a" }, source: { file: "a.env", line: 1 } },
          { value: { kind: "text", text: "b" }, source: { file: "b.env", line: 2 } },
        ],
        definedIn: 2,
      },
    ]);
    expect(detail().textContent).toContain("同名变量在多个文件中定义");
    expect(detail().textContent).toContain("各文件的值（读取顺序）");
    expect(detail().textContent).not.toContain("最终生效值");
    expect(within(detail()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list()).getByRole("button", { name: /^API_URL/ }).textContent).toContain("在 2 个文件中定义");
  });

  it("offers edit and remove for the selected variable only", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    renderList({ onEdit, onRemove });

    expect(screen.queryByRole("button", { name: "修改 ZED" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改 EDITOR" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ name: "EDITOR" }));

    pick("ZED");
    fireEvent.click(screen.getByRole("button", { name: "移除 ZED" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ name: "ZED" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("filters the list by search and updates the count, then clears", () => {
    renderList();
    expect(screen.getByText("共 3 项")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索变量"), { target: { value: "zed" } });
    expect(screen.getByText("匹配 1 / 共 3 项")).toBeTruthy();
    expect(names()).toEqual(["ZED"]);
    expect(within(detail()).getByRole("heading", { level: 3 }).textContent).toBe("ZED");

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByText("共 3 项")).toBeTruthy();
    expect(names()).toHaveLength(3);
  });
});

describe("variable list layout", () => {
  it("puts the list and the detail side by side in one master-detail wrapper", () => {
    const markup = renderToStaticMarkup(
      <VariableChainList label="变量" onRevealFinal={() => Promise.resolve("")} rows={ROWS} searchKey="layout-static" />,
    );
    const wrapper = markup.indexOf("sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
    const listAt = markup.indexOf('aria-label="变量"');
    const detailAt = markup.indexOf('aria-label="选中变量的详情"');
    expect(wrapper).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(wrapper);
    expect(detailAt).toBeGreaterThan(listAt);
  });

  it("makes the list and the detail siblings under the same wrapper", () => {
    renderList();
    expect(list().parentElement).toBe(detail().parentElement);
    expect(list().parentElement?.className).toContain("sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
  });
});
