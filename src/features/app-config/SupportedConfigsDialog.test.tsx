// @vitest-environment jsdom
/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigListItem, AppConfigProbeStatus, AppConfigSupportedEntry } from "../../ipc/appConfig";
import { SupportedConfigsAction } from "./SupportedConfigsAction";
import { SupportedConfigsDialog } from "./SupportedConfigsDialog";

const mocks = vi.hoisted(() => ({ listSupportedAppConfigEntries: vi.fn() }));

vi.mock("../../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/appConfig")>()),
  listSupportedAppConfigEntries: mocks.listSupportedAppConfigEntries,
}));

const SCOPE = "这里列出 UserHome 支持查看的应用配置；本机没有的不会出现在左侧列表。";

const SUPPORTED: AppConfigSupportedEntry[] = [
  { id: "git-config-home", name: "Git 全局配置", category: "developerTool", format: "ini", capability: "writable" },
  { id: "git-config-xdg", name: "Git 全局配置（XDG 位置）", category: "developerTool", format: "ini", capability: "writable" },
  { id: "git-credentials", name: "Git 明文凭据库", category: "developerTool", format: "text", capability: "discoverOnly" },
  { id: "tmux-conf", name: "tmux 配置", category: "terminal", format: "text", capability: "readOnly" },
  { id: "tmux-config-xdg", name: "tmux 配置（XDG 位置）", category: "terminal", format: "text", capability: "readOnly" },
  { id: "ssh-system-config", name: "SSH 系统配置", category: "system", format: "text", capability: "readOnly" },
];

const FOUND: AppConfigProbeStatus = { status: "found", size: 10, modifiedUnixMillis: 1 };

function item(id: string, probe: AppConfigProbeStatus): AppConfigListItem {
  return {
    summary: {
      id,
      name: id,
      category: "developerTool",
      displayPath: `~/${id}`,
      format: "ini",
      capability: "readOnly",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-23",
    },
    probe,
  };
}

// List items have no accessible name, so a row is found by the tool name it starts with.
function rows(): HTMLElement[] {
  return screen.queryAllByRole("listitem");
}

function rowFor(name: string): HTMLElement {
  const row = rows().find((candidate) => candidate.textContent?.startsWith(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

async function waitForRows(): Promise<void> {
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

beforeEach(() => {
  mocks.listSupportedAppConfigEntries.mockReset().mockResolvedValue(SUPPORTED);
});

afterEach(() => {
  cleanup();
});

describe("SupportedConfigsDialog", () => {
  it("opens as a dialog that states what the sheet covers", async () => {
    render(
      <SupportedConfigsDialog open onClose={() => undefined} items={[item("git-config-home", FOUND)]} />,
    );

    expect(screen.getByRole("dialog", { name: "支持的配置" })).toBeTruthy();
    expect(screen.getByText(SCOPE)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("正在读取支持的配置……")).toBeNull());
  });

  it("lists one row per tool, merging the two Git locations and the two tmux locations", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    await waitForRows();
    expect(rows()).toHaveLength(3);
    expect(rowFor("Git")).toBeTruthy();
    expect(rowFor("tmux")).toBeTruthy();
    expect(rowFor("SSH")).toBeTruthy();
  });

  it("shows each tool's one-sentence purpose next to its name", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    await waitForRows();
    expect(screen.getByText("全局身份、默认分支与行为设置。")).toBeTruthy();
    expect(within(rowFor("Git")).getByText("全局身份、默认分支与行为设置。")).toBeTruthy();
  });

  it("marks each tool with a text status badge, not a colour alone", async () => {
    const items = [
      item("git-config-home", FOUND),
      item("ssh-system-config", { status: "inaccessible" }),
    ];
    render(<SupportedConfigsDialog open onClose={() => undefined} items={items} />);

    await waitForRows();
    expect(within(rowFor("Git")).getByText("已发现")).toBeTruthy();
    expect(within(rowFor("tmux")).getByText("未发现")).toBeTruthy();
    expect(within(rowFor("SSH")).getByText("无法检查")).toBeTruthy();
  });

  it("shows a line icon in every row, hidden from assistive technology", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    await waitForRows();
    for (const row of rows()) {
      const svg = row.querySelector("svg");
      expect(svg, row.textContent ?? "").not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("width")).toBe("24");
      expect(svg?.getAttribute("height")).toBe("24");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("fill")).toBe("none");
    }
  });

  it("keeps rows as plain list items, not selectable buttons", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    await waitForRows();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryAllByRole("button").filter((button) => button.closest("li"))).toHaveLength(0);
    expect(rows().some((row) => row.hasAttribute("aria-selected"))).toBe(false);
  });

  it("explains a failed read and offers a retry", async () => {
    mocks.listSupportedAppConfigEntries.mockRejectedValueOnce({ code: "INTERNAL", message: "内部错误", retryable: true });
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("reads the supported list again when the retry button is pressed", async () => {
    mocks.listSupportedAppConfigEntries
      .mockReset()
      .mockRejectedValueOnce({ code: "INTERNAL", message: "内部错误", retryable: true })
      .mockResolvedValueOnce(SUPPORTED);
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: "重试" }));

    await waitForRows();
    expect(mocks.listSupportedAppConfigEntries).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks statuses as unchecked when the local listing is not available", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={undefined} />);

    await waitForRows();
    expect(within(rowFor("Git")).getByText("未检查")).toBeTruthy();
  });
});

describe("SupportedConfigsDialog sizing", () => {
  it("is min(720px, 90vw) wide, from the r8-appcfg block of global.css", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "global.css"), "utf8");
    const block = css.slice(css.indexOf("/* r8-appcfg */"), css.indexOf("/* /r8-appcfg */"));
    expect(block).toContain("width: min(720px, 90vw);");
    expect(block).not.toMatch(/clip-path|gradient|box-shadow|outline/);
  });
});

describe("SupportedConfigsDialog scrolling", () => {
  it("keeps the title fixed while the list body alone scrolls", async () => {
    render(<SupportedConfigsDialog open onClose={() => undefined} items={[]} />);
    await waitForRows();

    expect(document.getElementById("app-config-supported-title")?.closest(".overflow-y-auto")).toBeNull();
    const body = document.querySelector(".r8-appcfg-tools__body");
    expect(body?.classList.contains("overflow-y-auto")).toBe(true);
    expect(body?.querySelector(".overflow-y-auto")).toBeNull();
  });
});

describe("SupportedConfigsAction", () => {
  it("opens the sheet from a button and closes on Escape, returning focus to the button", async () => {
    render(<SupportedConfigsAction items={[]} />);
    const trigger = screen.getByRole("button", { name: "支持的配置" });
    trigger.focus();

    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "支持的配置" })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the footer button as well", async () => {
    render(<SupportedConfigsAction items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "支持的配置" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
