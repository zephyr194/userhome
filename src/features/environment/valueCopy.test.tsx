// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { VariableChainTable } from "./VariableChainTable";
import type { VariableChainRow } from "./variableChainModel";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;
const SECRET = "s3cret-value-do-not-leak";
const LONG = Array.from({ length: 40 }, (_, index) => `/opt/tool-${index}/bin`).join(":");

const ROWS: VariableChainRow[] = [
  {
    name: "EDITOR",
    final: { value: { kind: "text", text: "code" }, source: { file: ".zshrc", line: 3 } },
    chain: [{ value: { kind: "text", text: "vim" }, source: { file: ".zprofile", line: 1 } }],
  },
  {
    name: "API_TOKEN",
    final: { value: { kind: "masked" }, source: { file: ".zshrc", line: 5 } },
    chain: [],
  },
  {
    name: "PATH",
    final: { value: { kind: "withheld" }, source: { file: ".zshenv", line: 2 } },
    chain: [],
  },
];

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function renderTable(onRevealFinal: (row: VariableChainRow) => Promise<string>, english = false) {
  const table = (
    <VariableChainTable label="变量" onRevealFinal={onRevealFinal} rows={ROWS} />
  );
  return render(english ? <LocaleProvider preference="en">{table}</LocaleProvider> : table);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("copying variable values", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("copies a plain value exactly from the final column and from a chain step", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    renderTable(() => Promise.resolve("unused"));

    fireEvent.click(screen.getByRole("button", { name: /过程值/ }));
    const [finalCopy, stepCopy] = screen.getAllByRole("button", { name: "复制 EDITOR 的值" });
    fireEvent.click(finalCopy);
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("code");

    fireEvent.click(stepCopy);
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("vim");
    expect(within(stepCopy.closest("li") as HTMLElement).getByRole("status").textContent).toBe("已复制");
  });

  it("explains a failed copy beside the value", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    renderTable(() => Promise.resolve("unused"));

    fireEvent.click(screen.getByRole("button", { name: "复制 EDITOR 的值" }));
    await flush();

    const cell = screen.getByRole("button", { name: "复制 EDITOR 的值" }).closest("td");
    expect(within(cell as HTMLElement).getByRole("status").textContent).toBe("复制失败");
  });

  it("offers no copy control for a secret until it is shown, then copies the real value", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { container } = renderTable(() => Promise.resolve(SECRET));

    expect(screen.queryByRole("button", { name: "复制 API_TOKEN 的值" })).toBeNull();
    expect(container.innerHTML).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));
    fireEvent.click(await screen.findByRole("button", { name: "显示 API_TOKEN 的值" }));
    expect(container.innerHTML).toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: "复制 API_TOKEN 的值" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it("copies the whole value of a long value once it is loaded", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    renderTable(() => Promise.resolve(LONG));

    fireEvent.click(screen.getByRole("button", { name: "载入 PATH 的值" }));
    expect(await screen.findByText(LONG)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "复制 PATH 的值" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(LONG);
    expect(LONG.length).toBeGreaterThan(300);
  });

  it("labels the copy controls in English without Chinese characters", async () => {
    stubClipboard(() => Promise.resolve());
    const { container } = renderTable(() => Promise.resolve("unused"), true);

    fireEvent.click(screen.getByRole("button", { name: "Copy the value of EDITOR" }));
    await flush();

    const cell = screen.getByRole("button", { name: "Copy the value of EDITOR" }).closest("td");
    expect(within(cell as HTMLElement).getByRole("status").textContent).toBe("Copied");
    expect(CJK_PATTERN.test(container.textContent ?? "")).toBe(false);
  });
});
