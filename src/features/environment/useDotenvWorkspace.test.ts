// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listGrants, selectSaveLocationGrant, type GrantSummary } from "../../ipc/grants";
import { useDotenvWorkspace } from "./useDotenvWorkspace";

vi.mock("../../ipc/grants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/grants")>()),
  listGrants: vi.fn(),
  selectSaveLocationGrant: vi.fn(),
}));

vi.mock("../../ipc/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/environment")>()),
  scanEnvironmentFiles: vi.fn(() => new Promise(() => undefined)),
  readEnvironmentFile: vi.fn(() => new Promise(() => undefined)),
  revealEnvironmentValue: vi.fn(() => new Promise(() => undefined)),
}));

const GRANT_A: GrantSummary = {
  id: "grant-a",
  purpose: "CONFIG_DIRECTORY",
  kind: "DIRECTORY",
  displayPath: "~/work/a",
  createdAtEpochMs: 1,
};
const GRANT_B: GrantSummary = { ...GRANT_A, id: "grant-b", displayPath: "~/work/b" };
const NEW_FILE: GrantSummary = {
  ...GRANT_A,
  id: "grant-c",
  purpose: "CONFIG_FILE",
  kind: "FILE",
  displayPath: "~/work/a/.env",
};

describe("switching directory tabs while the editor is open", () => {
  beforeEach(() => {
    vi.mocked(listGrants).mockResolvedValue([GRANT_A, GRANT_B]);
    vi.mocked(selectSaveLocationGrant).mockResolvedValue({ status: "SELECTED", grant: NEW_FILE });
  });

  it("says why the tab did not change, and drops that note when the editor closes", async () => {
    const { result } = renderHook(() => useDotenvWorkspace());
    await waitFor(() => expect(result.current.state.selectedGrantId).toBe("grant-a"));

    await act(async () => {
      result.current.actions.newFile();
    });
    await waitFor(() => expect(result.current.editor.state.phase).toBe("editing"));

    act(() => result.current.actions.selectGrant("grant-b"));
    expect(result.current.state.selectedGrantId).toBe("grant-a");
    expect(result.current.grantNotice?.text).toBe("正在编辑环境文件，请先保存或取消，再切换目录。");

    act(() => result.current.editor.controller.close());
    await waitFor(() => expect(result.current.grantNotice).toBeUndefined());

    act(() => result.current.actions.selectGrant("grant-b"));
    expect(result.current.state.selectedGrantId).toBe("grant-b");
  });
});
