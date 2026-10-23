// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewQr } from "../../ipc/qr";
import { CodecTool } from "./CodecTool";
import { JsonTool } from "./JsonTool";
import { QrTool } from "./QrTool";
import { QR_MAX_BYTES } from "./qrToolState";
import { XmlTool } from "./XmlTool";

vi.mock("../../ipc/qr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/qr")>()),
  previewQr: vi.fn(() => new Promise(() => {})),
}));

const OVERSIZED_MESSAGE = "输入超过 1 MiB 上限，未发送。";

function stubClipboard(text: string) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: vi.fn(() => Promise.resolve(text)) },
  });
}

function inputOf(label: string) {
  return screen.getByRole("textbox", { name: label }) as HTMLTextAreaElement;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.clearAllMocks();
});

const TOOLS = [
  { name: "文本编解码", Component: CodecTool, label: "输入" },
  { name: "JSON 格式化", Component: JsonTool, label: "输入" },
  { name: "XML 格式化", Component: XmlTool, label: "输入" },
  { name: "二维码生成", Component: QrTool, label: "文本或 URL" },
] as const;

describe.each(TOOLS)("$name 输入框的读取粘贴板", ({ Component, label }) => {
  it("puts the paste button in the input's title row", () => {
    render(<Component />);
    const title = screen.getByText(label, { selector: "label" });
    const button = screen.getByRole("button", { name: "读取粘贴板" });
    expect(title.parentElement?.contains(button)).toBe(true);
  });

  it("replaces the current input with the clipboard text", async () => {
    stubClipboard("新的内容");
    render(<Component />);
    fireEvent.change(inputOf(label), { target: { value: "旧内容" } });

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(inputOf(label).value).toBe("新的内容"));
  });
});

describe("工具输入框粘贴后的状态路径", () => {
  it("runs the QR preview for pasted text, as it does for typed text", async () => {
    stubClipboard("https://example.com");
    render(<QrTool />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() =>
      expect(previewQr).toHaveBeenCalledWith(
        expect.objectContaining({ text: "https://example.com" }),
      ),
    );
  });

  it("keeps the QR preview off when pasted text exceeds the level limit", async () => {
    stubClipboard("a".repeat(QR_MAX_BYTES.M + 1));
    render(<QrTool />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));

    await waitFor(() => expect(inputOf("文本或 URL").value.length).toBe(QR_MAX_BYTES.M + 1));
    expect(previewQr).not.toHaveBeenCalled();
  });

  it("uses the codec's existing oversized notice when pasted text is too large", async () => {
    stubClipboard("a".repeat(1024 * 1024 + 1));
    render(<CodecTool />);

    fireEvent.click(screen.getByRole("button", { name: "读取粘贴板" }));
    await waitFor(() => expect(inputOf("输入").value.length).toBe(1024 * 1024 + 1));
    fireEvent.click(screen.getByRole("button", { name: "转换" }));

    expect(await screen.findByText(OVERSIZED_MESSAGE)).toBeTruthy();
  });
});
