// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeViewer } from "./CodeViewer";
import { HIGHLIGHT_MAX_BYTES } from "./codeTokens";

afterEach(cleanup);

const LABEL = "解析后的内容";
const DOTENV = "# 注释\nPORT=8080\nNAME=\"user home\"\n";

function renderViewer(text: string, language: "dotenv" | "json" | "plain" = "dotenv") {
  return render(
    <CodeViewer label={LABEL} language={language} text={text} title="settings.env" />,
  );
}

function copyableText(region: HTMLElement): string {
  const clone = region.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return Array.from(clone.querySelectorAll(".r6-code-line"))
    .map((line) => line.textContent ?? "")
    .join("\n");
}

describe("CodeViewer", () => {
  it("names the code region and renders highlighted tokens", () => {
    renderViewer(DOTENV);
    const region = screen.getByRole("region", { name: LABEL });
    expect(region.querySelector('[data-token="comment"]')?.textContent).toBe("# 注释");
    expect(region.querySelector('[data-token="key"]')?.textContent).toBe("PORT");
    expect(region.querySelector('[data-token="number"]')?.textContent).toBe("8080");
    expect(region.querySelector('[data-token="string"]')?.textContent).toBe('"user home"');
  });

  it("numbers lines with hidden gutters that are excluded from copied text", () => {
    renderViewer(DOTENV);
    const region = screen.getByRole("region", { name: LABEL });
    const gutters = region.querySelectorAll(".r6-code-gutter");
    expect(gutters).toHaveLength(3);
    expect(gutters[0].getAttribute("aria-hidden")).toBe("true");
    expect(gutters[2].textContent).toBe("3");
    expect(copyableText(region)).toBe(DOTENV.replace(/\n$/, ""));
  });

  it("keeps the source text intact even when it contains line-break variants", () => {
    const text = "A=1\r\nB=2\rC=3";
    renderViewer(text);
    const region = screen.getByRole("region", { name: LABEL });
    expect(copyableText(region)).toBe("A=1\nB=2\nC=3");
  });

  it("switches between wrapped and unwrapped lines with the same label", () => {
    renderViewer("X=" + "1".repeat(200));
    const region = screen.getByRole("region", { name: LABEL });
    expect(region.className).toContain("overflow-x-auto whitespace-pre");
    fireEvent.click(screen.getByRole("button", { name: "换行" }));
    expect(region.className).toContain("whitespace-pre-wrap");
    expect(screen.getByRole("button", { name: "不换行" })).toBeTruthy();
  });

  it("opens the text in a window, closes it with Escape and returns focus to the trigger", async () => {
    renderViewer(DOTENV);
    const trigger = screen.getByRole("button", { name: "在窗口中查看" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "settings.env" });
    expect(dialog.querySelector('[data-token="key"]')?.textContent).toBe("PORT");
    expect(dialog.textContent).toContain("关闭");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes the window from its footer button", async () => {
    renderViewer(DOTENV);
    fireEvent.click(screen.getByRole("button", { name: "在窗口中查看" }));
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the same text in the window, without line numbers in the copyable content", async () => {
    renderViewer(DOTENV);
    fireEvent.click(screen.getByRole("button", { name: "在窗口中查看" }));
    const dialog = await screen.findByRole("dialog", { name: "settings.env" });
    const regions = dialog.querySelectorAll('[role="region"]');
    expect(regions).toHaveLength(1);
    expect(copyableText(regions[0] as HTMLElement)).toBe(DOTENV.replace(/\n$/, ""));
  });

  it("turns highlighting off for content over 200 KB and says so", () => {
    const large = "KEY=1\n" + "x".repeat(HIGHLIGHT_MAX_BYTES);
    renderViewer(large);
    const region = screen.getByRole("region", { name: LABEL });
    expect(region.querySelectorAll("[data-token]")).toHaveLength(0);
    expect(screen.getByText("内容较长，已关闭高亮。")).toBeTruthy();
    expect(copyableText(region)).toBe(large);
  });

  it("keeps highlighting for content exactly at the limit", () => {
    renderViewer("KEY=1", "dotenv");
    expect(screen.queryByText("内容较长，已关闭高亮。")).toBeNull();
  });

  it("shows the caller's notice beside the controls", () => {
    render(
      <CodeViewer
        label={LABEL}
        language="json"
        notice={<p>敏感值已遮盖（显示为 [REDACTED]）。</p>}
        text='{"apiKey": "[REDACTED]"}'
        title="settings.json"
      />,
    );
    expect(screen.getByText("敏感值已遮盖（显示为 [REDACTED]）。")).toBeTruthy();
    const region = screen.getByRole("region", { name: LABEL });
    expect(region.querySelector('[data-token="key"]')?.textContent).toBe('"apiKey"');
  });

  it("renders plain text without token markup", () => {
    renderViewer("# not a comment", "plain");
    const region = screen.getByRole("region", { name: LABEL });
    expect(region.querySelectorAll("[data-token]")).toHaveLength(0);
    expect(region.textContent).toContain("# not a comment");
  });
});

describe("CodeViewer inside a dialog", () => {
  it("hides the window button when allowWindow is false", () => {
    render(
      <CodeViewer allowWindow={false} label={LABEL} language="dotenv" text={DOTENV} title="a.env" />,
    );
    expect(screen.queryByRole("button", { name: "在窗口中查看" })).toBeNull();
    expect(screen.getByRole("button", { name: "换行" })).toBeTruthy();
  });
});
