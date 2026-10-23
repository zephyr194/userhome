// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataHub } from "./dataHub";
import { AiConfigPage } from "../features/ai-config/AiConfigPage";
import { BrewUpdate } from "../features/ai-config/BrewUpdate";
import { AppConfigPage } from "../features/app-config/AppConfigPage";
import { ZshPage } from "../features/environment/ZshPage";
import { useDotenvWorkspace } from "../features/environment/useDotenvWorkspace";

const mocks = vi.hoisted(() => ({
  listGrants: vi.fn(),
  selectDirectoryGrant: vi.fn(),
  readZshStartupFiles: vi.fn(),
  listAppConfigEntries: vi.fn(),
  aiConfigBrewUpgrade: vi.fn(),
}));

vi.mock("../ipc/grants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/grants")>()),
  listGrants: mocks.listGrants,
  selectDirectoryGrant: mocks.selectDirectoryGrant,
}));
vi.mock("../ipc/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/environment")>()),
  readZshStartupFiles: mocks.readZshStartupFiles,
}));
vi.mock("../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/appConfig")>()),
  listAppConfigEntries: mocks.listAppConfigEntries,
}));
vi.mock("../ipc/aiConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/aiConfig")>()),
  aiConfigBrewUpgrade: mocks.aiConfigBrewUpgrade,
}));

const AI_TOOLS = [
  ["claude-code", "Claude Code"],
  ["codex-cli", "Codex CLI"],
  ["gemini-cli", "Gemini CLI"],
  ["copilot-cli", "GitHub Copilot CLI"],
].map(([id, displayName]) => ({
  id,
  displayName,
  installStatus: "missing",
  installSource: null,
  displayPath: null,
  invalidReason: null,
  version: null,
  configPresence: "notRegistered",
  configDisplayPath: null,
  references: ["https://example.com/docs"],
  verificationNote: "待核验",
}));

const ZSH_OVERVIEW = {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: [],
    zdotdir: { status: "DEFAULT" },
    files: [
      {
        file: "ZSHRC",
        name: ".zshrc",
        appliesTo: "INTERACTIVE",
        position: 6,
        outcome: { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "文件不存在或已被移动。" },
      },
    ],
  };

beforeEach(() => {
  mocks.listGrants.mockReset().mockResolvedValue([
    { id: "1", kind: "DIRECTORY", purpose: "CONFIG_DIRECTORY", displayPath: "~/a", createdAtEpochMs: 1 },
    { id: "2", kind: "DIRECTORY", purpose: "CADDY_WORK_DIR", displayPath: "~/c", createdAtEpochMs: 1 },
  ]);
  mocks.readZshStartupFiles.mockReset().mockResolvedValue(ZSH_OVERVIEW);
  mocks.listAppConfigEntries.mockReset().mockResolvedValue([]);
  mocks.aiConfigBrewUpgrade.mockReset();
  dataHub.clear();
});

afterEach(() => {
  cleanup();
  clearMocks();
  dataHub.clear();
});

describe("overview data is published by the pages that read it", () => {
  it("publishes the authorized directory count when the dotenv workspace loads its grants", async () => {
    renderHook(() => useDotenvWorkspace());
    await waitFor(() =>
      expect(dataHub.state("authorizedDirectories")).toMatchObject({
        status: "ready",
        reading: { value: 1 },
      }),
    );
  });

  it("publishes the READY zsh startup file count when the zsh page reads the default files", async () => {
    render(<ZshPage />);
    await waitFor(() =>
      expect(dataHub.state("zshStartup")).toMatchObject({ status: "ready", reading: { value: 0 } }),
    );
  });

  it("publishes the app config entry count when the app config list loads", async () => {
    render(<AppConfigPage />);
    await waitFor(() =>
      expect(dataHub.state("appConfig")).toMatchObject({ status: "ready", reading: { value: 0 } }),
    );
  });

  it("publishes the AI tool report when the AI config page detects tools", async () => {
    mockIPC((command) => {
      if (command !== "ai_config_detect") throw new Error(`unexpected command ${command}`);
      return { tools: AI_TOOLS };
    });
    render(<AiConfigPage />);
    await waitFor(() =>
      expect(dataHub.state("aiTools")).toMatchObject({ status: "ready", reading: { value: { tools: AI_TOOLS } } }),
    );
  });
});

describe("overview data is invalidated after a write", () => {
  it("invalidates the AI tool data after a successful Homebrew update", async () => {
    mocks.aiConfigBrewUpgrade.mockResolvedValue({ status: "UPGRADED", newVersion: "2.0.0" } as never);
    const invalidate = vi.spyOn(dataHub, "invalidate");
    const onRefreshed = vi.fn();
    render(
      <BrewUpdate
        displayName="Claude Code"
        onRefreshed={onRefreshed}
        packageName="claude-code"
        toolId="claude-code"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "开始更新" }));
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith("aiTools");
    invalidate.mockRestore();
  });
});

describe("overview data is invalidated after a grant changes", () => {
  it("invalidates the authorized directory data when a ZDOTDIR folder is granted", async () => {
    mocks.selectDirectoryGrant.mockResolvedValue({
      status: "SELECTED",
      grant: { id: "g-1", kind: "DIRECTORY", purpose: "ZDOTDIR", displayPath: "~/z", createdAtEpochMs: 1 },
    });
    mocks.readZshStartupFiles.mockResolvedValue({
      ...ZSH_OVERVIEW,
      zdotdir: { status: "UNDETERMINED", reason: "DYNAMIC" },
    });
    const invalidate = vi.spyOn(dataHub, "invalidate");
    render(<ZshPage />);
    fireEvent.click(await screen.findByRole("button", { name: "选择 ZDOTDIR 目录…" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith("authorizedDirectories"));
    invalidate.mockRestore();
  });
});
