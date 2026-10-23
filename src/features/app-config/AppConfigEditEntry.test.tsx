// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfigListItem } from "../../ipc/appConfig";
import { AppConfigView, type AppConfigEditControls } from "./AppConfigView";
import type { DetailState, ListState } from "./appConfigModel";

vi.mock("../../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/appConfig")>()),
  getAppConfigSchema: vi.fn(() => new Promise(() => undefined)),
  readAppConfigForEdit: vi.fn(() => new Promise(() => undefined)),
  previewAppConfigEdit: vi.fn(),
  confirmAppConfigEdit: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function item(
  id: string,
  capability: AppConfigListItem["summary"]["capability"],
): AppConfigListItem {
  return {
    summary: {
      id,
      name: `名称 ${id}`,
      category: "developerTool",
      displayPath: `~/.config/${id}`,
      format: "ini",
      capability,
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
    },
    probe: { status: "found", size: 10, modifiedUnixMillis: 1_700_000_000_000 },
  };
}

const WRITABLE = item("git-config", "writable");
const READ_ONLY = item("zed-settings", "readOnly");

function readyList(items: AppConfigListItem[]): ListState {
  return { status: "ready", items };
}

function selected(id: string): DetailState {
  return {
    status: "ready",
    requestId: 1,
    id,
    result: {
      outcome: "metadataOnly",
      meta: { size: 10, modifiedUnixMillis: 1_700_000_000_000 },
    },
  };
}

function controls(overrides: Partial<AppConfigEditControls> = {}): AppConfigEditControls {
  return {
    editingId: null,
    notice: null,
    onStart: vi.fn(),
    onExit: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
}

describe("应用配置详情的编辑入口", () => {
  it("shows 编辑 only for a writable entry that is selected", () => {
    render(
      <AppConfigView
        list={readyList([WRITABLE, READ_ONLY])}
        detail={selected("git-config")}
        edit={controls()}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
  });

  it("hides 编辑 for a read-only entry", () => {
    render(
      <AppConfigView
        list={readyList([WRITABLE, READ_ONLY])}
        detail={selected("zed-settings")}
        edit={controls()}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("hides 编辑 when no edit controls are supplied", () => {
    render(
      <AppConfigView
        list={readyList([WRITABLE])}
        detail={selected("git-config")}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("starts editing for the selected writable entry", () => {
    const edit = controls();
    render(
      <AppConfigView
        list={readyList([WRITABLE])}
        detail={selected("git-config")}
        edit={edit}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(edit.onStart).toHaveBeenCalledWith("git-config");
  });

  it("locks the entry list while editing, so the draft cannot be silently dropped", () => {
    const onSelect = vi.fn();
    render(
      <AppConfigView
        list={readyList([WRITABLE, READ_ONLY])}
        detail={selected("git-config")}
        edit={controls({ editingId: "git-config" })}
        onReload={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const other = screen.getByRole("button", { name: /名称 zed-settings/ }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    expect(screen.getByText("编辑中不能切换条目，请先返回查看。")).toBeTruthy();
    fireEvent.click(other);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the save notice above the detail when not editing", () => {
    render(
      <AppConfigView
        list={readyList([WRITABLE])}
        detail={selected("git-config")}
        edit={controls({ notice: "已保存，并备份了原文件。" })}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("已保存，并备份了原文件。");
  });

  it("replaces the read-only content with the editor while editing", () => {
    render(
      <AppConfigView
        list={readyList([WRITABLE])}
        detail={selected("git-config")}
        edit={controls({ editingId: "git-config" })}
        onReload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "返回查看" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByText("仅显示已发现、大小与修改时间，不读取内容。")).toBeNull();
  });
});
