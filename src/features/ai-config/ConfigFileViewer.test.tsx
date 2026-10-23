// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rtl = typeof import("@testing-library/react");

const MASKED_CONTENT = '{\n  "apiKey": "••••••",\n  "model": "sonnet"\n}';
const LEAKED_SECRET = "sk-abcdefghijkl";

function configWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    toolId: "claude-code",
    displayPath: "~/.claude/settings.json",
    exists: true,
    language: "json",
    content: MASKED_CONTENT,
    truncated: false,
    sizeBytes: 48,
    redactedCount: 1,
    readAt: "2026-10-23T00:00:00Z",
    ...overrides,
  };
}

let rtl: Rtl;
let ConfigFileViewer: typeof import("./ConfigFileViewer").ConfigFileViewer;
let LocaleProvider: typeof import("../../i18n/LocaleProvider").LocaleProvider;
let calls: { command: string; payload: unknown }[];

beforeEach(async () => {
  vi.resetModules();
  rtl = await import("@testing-library/react");
  ({ ConfigFileViewer } = await import("./ConfigFileViewer"));
  ({ LocaleProvider } = await import("../../i18n/LocaleProvider"));
  calls = [];
});

afterEach(() => {
  rtl.cleanup();
  clearMocks();
});

function mountViewer(toolId: "claude-code" | "gemini-cli" = "claude-code", preference: "zh-CN" | "en" = "zh-CN") {
  return rtl.render(
    <LocaleProvider preference={preference}>
      <ConfigFileViewer toolId={toolId} />
    </LocaleProvider>,
  );
}

function serveConfig(respond: (payload: { toolId: string }) => unknown = () => configWire()) {
  mockIPC((command, payload) => {
    calls.push({ command, payload });
    return respond(payload as { toolId: string });
  });
}

describe("ConfigFileViewer", () => {
  it("does not read the file until the user asks for it", () => {
    serveConfig();

    const { container } = mountViewer();

    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain("查看当前配置");
    expect(container.textContent).not.toContain("sonnet");
  });

  it("reads on demand and shows the masked content with a redaction notice", async () => {
    serveConfig();
    const { container } = mountViewer();

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));

    await rtl.waitFor(() => expect(container.textContent).toContain("sonnet"));
    expect(calls).toEqual([{ command: "ai_config_read_config", payload: { toolId: "claude-code" } }]);
    expect(container.textContent).toContain("已遮盖 1 处秘密值。");
    expect(container.textContent).toContain("只读展示，秘密值已遮盖。");
  });

  it("shows the path and a plain sentence when the file does not exist", async () => {
    serveConfig(() =>
      configWire({ exists: false, content: null, sizeBytes: null, redactedCount: 0 }),
    );
    const { container } = mountViewer();

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));

    await rtl.waitFor(() => expect(container.textContent).toContain("该工具尚未创建配置文件。"));
    expect(container.textContent).toContain("~/.claude/settings.json");
    expect(rtl.screen.queryByRole("alert")).toBeNull();
  });

  it("offers a retry after a failed read and recovers on success", async () => {
    let attempt = 0;
    serveConfig(() => {
      attempt += 1;
      if (attempt === 1) throw new Error("backend unavailable");
      return configWire();
    });
    const { container } = mountViewer();

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));

    await rtl.waitFor(() => expect(rtl.screen.getByRole("alert")).toBeTruthy());
    expect(container.textContent).toContain("无法读取当前配置");
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "重试" }));

    await rtl.waitFor(() => expect(container.textContent).toContain("sonnet"));
    expect(rtl.screen.queryByRole("alert")).toBeNull();
  });

  it("tells the user when only the first 256 KiB is shown", async () => {
    serveConfig(() => configWire({ truncated: true, redactedCount: 0 }));
    const { container } = mountViewer();

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));

    await rtl.waitFor(() => expect(container.textContent).toContain("仅显示前 256 KiB。"));
    expect(container.textContent).not.toMatch(/已遮盖 \d/);
  });

  it("re-reads the file when refresh is pressed", async () => {
    serveConfig();
    const { container } = mountViewer();
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));
    await rtl.waitFor(() => expect(container.textContent).toContain("sonnet"));

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "刷新" }));

    await rtl.waitFor(() => expect(calls).toHaveLength(2));
  });

  it("collapses back to the closed state without keeping the content", async () => {
    serveConfig();
    const { container } = mountViewer();
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));
    await rtl.waitFor(() => expect(container.textContent).toContain("sonnet"));

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "收起" }));

    expect(container.textContent).not.toContain("sonnet");
    expect(rtl.screen.getByRole("button", { name: "查看当前配置" })).toBeTruthy();
  });

  it("does not show another tool's content after switching tools", async () => {
    serveConfig((payload) =>
      payload.toolId === "claude-code"
        ? configWire()
        : configWire({ toolId: "gemini-cli", content: '{"theme":"dark"}', redactedCount: 0 }),
    );
    const first = mountViewer("claude-code");
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));
    await rtl.waitFor(() => expect(first.container.textContent).toContain("sonnet"));
    first.unmount();

    const { container } = mountViewer("gemini-cli");

    expect(container.textContent).not.toContain("sonnet");
    expect(container.textContent).not.toContain("theme");
  });

  it("never renders the raw secret that the backend masked", async () => {
    serveConfig();
    const { container } = mountViewer();

    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "查看当前配置" }));
    await rtl.waitFor(() => expect(container.textContent).toContain("sonnet"));

    expect(container.textContent).not.toContain(LEAKED_SECRET);
  });

  it("renders the English interface completely", async () => {
    serveConfig();
    const { container } = mountViewer("claude-code", "en");

    expect(container.textContent).toContain("View current configuration");
    rtl.fireEvent.click(rtl.screen.getByRole("button", { name: "View current configuration" }));
    await rtl.waitFor(() => expect(container.textContent).toContain("Masked 1 secret value(s)."));
    expect(container.textContent).toContain("Read-only. Secret values are masked.");
    expect(container.textContent).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\uffef]/);
  });
});
