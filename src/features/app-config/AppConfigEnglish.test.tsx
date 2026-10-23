// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type {
  AppConfigEditRead,
  AppConfigListItem,
  AppConfigSchema,
  AppConfigSupportedEntry,
} from "../../ipc/appConfig";
import { AppConfigPage } from "./AppConfigPage";

const mocks = vi.hoisted(() => ({
  listAppConfigEntries: vi.fn(),
  readAppConfigEntry: vi.fn(),
  listSupportedAppConfigEntries: vi.fn(),
  getAppConfigSchema: vi.fn(),
  readAppConfigForEdit: vi.fn(),
}));

vi.mock("../../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/appConfig")>()),
  listAppConfigEntries: mocks.listAppConfigEntries,
  readAppConfigEntry: mocks.readAppConfigEntry,
  listSupportedAppConfigEntries: mocks.listSupportedAppConfigEntries,
  getAppConfigSchema: mocks.getAppConfigSchema,
  readAppConfigForEdit: mocks.readAppConfigForEdit,
}));

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function expectNoCjk(text: string) {
  expect(CJK_PATTERN.test(text)).toBe(false);
}

function entry(
  id: string,
  name: string,
  category: AppConfigListItem["summary"]["category"],
  capability: AppConfigListItem["summary"]["capability"] = "readOnly",
): AppConfigListItem {
  return {
    summary: {
      id,
      name,
      category,
      displayPath: `~/.config/${id}`,
      format: "json",
      capability,
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
    },
    probe: { status: "found", size: 120, modifiedUnixMillis: 1_700_000_000_000 },
  };
}

const ZED = entry("zed-settings", "Zed 设置", "editor");
const GIT = entry("git-config-home", "Git 全局配置", "developerTool", "writable");

const SUPPORTED: AppConfigSupportedEntry[] = [
  { id: "git-config-home", name: "Git 全局配置", category: "developerTool", format: "ini", capability: "writable" },
  { id: "zed-settings", name: "Zed 设置", category: "editor", format: "json", capability: "readOnly" },
];

const SCHEMA: AppConfigSchema = {
  visualSupported: true,
  advancedSupported: false,
  formatLabel: "INI（Git 配置格式）",
  fields: [
    {
      path: "user.name",
      label: "提交作者名",
      description: "每次提交时记录的作者名称。",
      kind: "string",
      enumValues: [],
      min: null,
      max: null,
      pattern: null,
      default: null,
      sensitive: false,
    },
  ],
};

const EDIT_READ: AppConfigEditRead = {
  fields: [{ path: "user.name", present: true, value: "Archie" }],
  rawText: null,
  hash: "hash-1",
  rawBlockedReason: null,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listAppConfigEntries.mockResolvedValue([ZED, GIT]);
  mocks.readAppConfigEntry.mockResolvedValue({
    outcome: "content",
    view: { text: '{ "theme": "One Dark" }', redacted: false, withheldLines: 0, warnings: [] },
  });
  mocks.listSupportedAppConfigEntries.mockResolvedValue(SUPPORTED);
  mocks.getAppConfigSchema.mockResolvedValue(SCHEMA);
  mocks.readAppConfigForEdit.mockResolvedValue(EDIT_READ);
});

afterEach(cleanup);

function renderPageInEnglish() {
  return render(
    <LocaleProvider preference="en">
      <AppConfigPage />
    </LocaleProvider>,
  );
}

describe("app config page in English", () => {
  it("shows the listing, detail, and supported sheet without Chinese text", async () => {
    renderPageInEnglish();

    expect(await screen.findByRole("heading", { name: "Zed settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Editor" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Developer tools" })).toBeTruthy();
    expect(screen.getAllByText("Found").length).toBeGreaterThan(0);
    expectNoCjk(document.body.textContent ?? "");

    fireEvent.click(screen.getByRole("button", { name: "Supported configs" }));
    expect(
      await screen.findByText("Global identity, default branch, and behavior settings."),
    ).toBeTruthy();
    expectNoCjk(document.body.textContent ?? "");
  });

  it("edits a writable entry with English field labels and messages", async () => {
    renderPageInEnglish();
    await screen.findByRole("heading", { name: "Zed settings" });

    fireEvent.click(screen.getByRole("button", { name: /Git global config/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const field = await screen.findByRole("textbox", { name: /Commit author name/ });
    expect(field).toBeTruthy();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(
      await screen.findByText("Enter a value. To delete this item, click Remove."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to view" })).toBeTruthy();
    await waitFor(() => expectNoCjk(document.body.textContent ?? ""));
  });
});
