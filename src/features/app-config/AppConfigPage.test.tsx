// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigListItem } from "../../ipc/appConfig";
import { AppConfigPage } from "./AppConfigPage";

const mocks = vi.hoisted(() => ({
  listAppConfigEntries: vi.fn(),
  readAppConfigEntry: vi.fn(),
}));

vi.mock("../../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/appConfig")>()),
  listAppConfigEntries: mocks.listAppConfigEntries,
  readAppConfigEntry: mocks.readAppConfigEntry,
}));

function item(id: string, category: AppConfigListItem["summary"]["category"]): AppConfigListItem {
  return {
    summary: {
      id,
      name: `名称 ${id}`,
      category,
      displayPath: `~/.config/${id}.json`,
      format: "json",
      capability: "readOnly",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
    },
    probe: { status: "notFound" },
  };
}

const ZED = item("zed-settings", "editor");
const NPMRC = item("npmrc", "editor");
const TMUX = item("tmux-conf", "terminal");

const NOT_FOUND_READ = {
  outcome: "unavailable",
  status: { status: "notFound" },
} as const;

function rowFor(id: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`名称 ${id}`) });
}

function isSelected(id: string): boolean {
  return rowFor(id).getAttribute("aria-current") === "true";
}

describe("AppConfigPage default selection", () => {
  beforeEach(() => {
    mocks.listAppConfigEntries.mockReset();
    mocks.readAppConfigEntry.mockReset();
    mocks.readAppConfigEntry.mockResolvedValue(NOT_FOUND_READ);
  });

  afterEach(cleanup);

  it("selects the first listed row on load and reads only that entry", async () => {
    mocks.listAppConfigEntries.mockResolvedValue([TMUX, ZED]);
    render(<AppConfigPage />);

    await waitFor(() => expect(isSelected("zed-settings")).toBe(true));
    expect(mocks.readAppConfigEntry).toHaveBeenCalledTimes(1);
    expect(mocks.readAppConfigEntry).toHaveBeenCalledWith("zed-settings");
    expect(mocks.listAppConfigEntries).toHaveBeenCalledTimes(1);
    expect(isSelected("tmux-conf")).toBe(false);
    expect(await screen.findByText("该默认位置没有文件。")).toBeTruthy();
  });

  it("keeps the user's choice when the list refreshes", async () => {
    mocks.listAppConfigEntries.mockResolvedValue([ZED, NPMRC]);
    const { rerender } = render(<AppConfigPage refreshId="1" />);
    await waitFor(() => expect(isSelected("zed-settings")).toBe(true));

    fireEvent.click(rowFor("npmrc"));
    await waitFor(() => expect(isSelected("npmrc")).toBe(true));
    expect(mocks.readAppConfigEntry).toHaveBeenCalledTimes(2);

    rerender(<AppConfigPage refreshId="2" />);
    await waitFor(() => expect(mocks.listAppConfigEntries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(isSelected("npmrc")).toBe(true));
    expect(isSelected("zed-settings")).toBe(false);
    expect(mocks.readAppConfigEntry).toHaveBeenCalledTimes(2);
  });

  it("falls back to the first row when the selected entry leaves the list", async () => {
    mocks.listAppConfigEntries.mockResolvedValueOnce([ZED, NPMRC]);
    const { rerender } = render(<AppConfigPage refreshId="1" />);
    await waitFor(() => expect(isSelected("zed-settings")).toBe(true));

    fireEvent.click(rowFor("npmrc"));
    await waitFor(() => expect(isSelected("npmrc")).toBe(true));

    mocks.listAppConfigEntries.mockResolvedValueOnce([ZED]);
    rerender(<AppConfigPage refreshId="2" />);
    await waitFor(() => expect(isSelected("zed-settings")).toBe(true));
    expect(mocks.readAppConfigEntry).toHaveBeenLastCalledWith("zed-settings");
    expect(mocks.readAppConfigEntry).toHaveBeenCalledTimes(3);
  });

  it("shows the empty state and reads nothing when the listing is empty", async () => {
    mocks.listAppConfigEntries.mockResolvedValue([]);
    render(<AppConfigPage />);

    expect(await screen.findByText("没有登记的应用配置条目。")).toBeTruthy();
    expect(mocks.readAppConfigEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /名称/ })).toBeNull();
  });
});
