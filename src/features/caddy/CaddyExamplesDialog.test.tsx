// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaddyExamplesDialog } from "./CaddyExamplesDialog";
import { CaddyRulesEditor } from "./CaddyRulesEditor";
import { CADDY_EXAMPLES, REFERENCE_NOTICE, type CaddyExample } from "./caddyExamples";
import { createIdSource } from "./caddyRulesModel";

const REGION = "Caddyfile 示例";
const COPY_FAILED = "复制失败：请在代码区选中文本后按 ⌘C。";
const COPIED = "已复制";

const FIRST = CADDY_EXAMPLES[0];
const REFERENCE = CADDY_EXAMPLES.find((example) => example.support === "reference") as CaddyExample;

function codeText(region: HTMLElement): string {
  const clone = region.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return Array.from(clone.querySelectorAll(".r6-code-line"))
    .map((line) => line.textContent ?? "")
    .join("\n");
}

// The code view shows one row per line, so a trailing newline is not a visible row.
function shown(text: string): string {
  return text.replace(/\n$/, "");
}

function tabFor(example: CaddyExample): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^${example.title}`) });
}

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开示例
      </button>
      <CaddyExamplesDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
    </>
  );
}

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
  return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
}

function renderDialog(onClose = vi.fn()) {
  render(<CaddyExamplesDialog open onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  mockClipboard(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("CaddyExamplesDialog", () => {
  it("lists every example as a tab and shows the first one as selected", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "配置示例" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(CADDY_EXAMPLES.length);
    expect(tabFor(FIRST).getAttribute("aria-selected")).toBe("true");
    expect(codeText(screen.getByRole("region", { name: REGION }))).toBe(shown(FIRST.text));
  });

  it("does not nest a second window inside the dialog", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "在窗口中查看" })).toBeNull();
  });

  it("shows the chosen example in the code area when another tab is selected", () => {
    renderDialog();
    fireEvent.click(tabFor(REFERENCE));
    expect(codeText(screen.getByRole("region", { name: REGION }))).toBe(shown(REFERENCE.text));
  });

  it("shows the reference notice only for reference-only examples", () => {
    renderDialog();
    expect(screen.queryByText(REFERENCE_NOTICE)).toBeNull();
    fireEvent.click(tabFor(REFERENCE));
    expect(screen.getByText(REFERENCE_NOTICE)).toBeTruthy();
  });

  it("copies the selected example's Caddyfile text and confirms beside the button", async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    renderDialog();
    fireEvent.click(tabFor(REFERENCE));
    fireEvent.click(screen.getByRole("button", { name: "复制示例" }));
    await waitFor(() => expect(screen.getByText(COPIED)).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(REFERENCE.text);
  });

  it("shows the explained failure message when the clipboard rejects", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "复制示例" }));
    await waitFor(() => expect(screen.getByText(COPY_FAILED)).toBeTruthy());
    expect(screen.queryByText(COPIED)).toBeNull();
  });

  it("closes on Escape and returns focus to the button that opened it", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "打开示例" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the footer close button", () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens from the rules section button and keeps the rules unchanged", () => {
    const onChange = vi.fn();
    render(
      <CaddyRulesEditor
        sites={[]}
        localErrors={{}}
        mapped={{ byField: {}, general: [] }}
        exposedSites={new Set()}
        ids={createIdSource()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "配置示例" }));
    expect(screen.getByRole("dialog", { name: "配置示例" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制示例" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
