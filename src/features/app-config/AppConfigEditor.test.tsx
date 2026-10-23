// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppConfigEditRead,
  AppConfigListItem,
  AppConfigPreviewResult,
  AppConfigSchema,
} from "../../ipc/appConfig";
import { AppConfigEditor } from "./AppConfigEditor";

const mocks = vi.hoisted(() => ({
  getAppConfigSchema: vi.fn(),
  readAppConfigForEdit: vi.fn(),
  previewAppConfigEdit: vi.fn(),
  confirmAppConfigEdit: vi.fn(),
}));

vi.mock("../../ipc/appConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/appConfig")>()),
  getAppConfigSchema: mocks.getAppConfigSchema,
  readAppConfigForEdit: mocks.readAppConfigForEdit,
  previewAppConfigEdit: mocks.previewAppConfigEdit,
  confirmAppConfigEdit: mocks.confirmAppConfigEdit,
}));

const FOUND_PROBE = { status: "found", size: 120, modifiedUnixMillis: 1_700_000_000_000 } as const;

function entry(overrides: Partial<AppConfigListItem["summary"]> = {}, probe: AppConfigListItem["probe"] = FOUND_PROBE): AppConfigListItem {
  return {
    summary: {
      id: "git-config",
      name: "Git 配置",
      category: "developerTool",
      displayPath: "~/.gitconfig",
      format: "ini",
      capability: "writable",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
      ...overrides,
    },
    probe,
  };
}

const SCHEMA: AppConfigSchema = {
  visualSupported: true,
  advancedSupported: true,
  formatLabel: "INI",
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
    {
      path: "core.tabsize",
      label: "缩进宽度",
      description: "显示制表符时的宽度。",
      kind: "integer",
      enumValues: [],
      min: 1,
      max: 8,
      pattern: null,
      default: "4",
      sensitive: false,
    },
    {
      path: "credential.token",
      label: "访问令牌",
      description: "不会回显。",
      kind: "string",
      enumValues: [],
      min: null,
      max: null,
      pattern: null,
      default: null,
      sensitive: true,
    },
  ],
};

const READ: AppConfigEditRead = {
  fields: [
    { path: "user.name", present: true, value: "Archie" },
    { path: "core.tabsize", present: false, value: null },
    { path: "credential.token", present: true, value: null },
  ],
  rawText: "[user]\n\tname = Archie\n",
  hash: "hash-1",
  rawBlockedReason: null,
};

const PREVIEW_OK: AppConfigPreviewResult = {
  ok: true,
  errors: [],
  diff: "- name = Archie\n+ name = Bo\n",
  warnings: [],
  previewToken: "token-1",
};

function renderEditor(
  item: AppConfigListItem = entry(),
  callbacks: { onExit?: () => void; onSaved?: () => void } = {},
) {
  const onExit = callbacks.onExit ?? vi.fn();
  const onSaved = callbacks.onSaved ?? vi.fn();
  render(<AppConfigEditor item={item} onExit={onExit} onSaved={onSaved} />);
  return { onExit, onSaved };
}

async function waitForLoaded() {
  await screen.findByRole("button", { name: "预览更改" });
}

beforeEach(() => {
  mocks.getAppConfigSchema.mockResolvedValue(SCHEMA);
  mocks.readAppConfigForEdit.mockResolvedValue(READ);
  mocks.previewAppConfigEdit.mockResolvedValue(PREVIEW_OK);
  mocks.confirmAppConfigEdit.mockResolvedValue({
    outcome: "unavailable",
    status: { status: "notFound" },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppConfigEditor 读取与模式", () => {
  it("shows the loading state before the schema and file arrive", () => {
    mocks.getAppConfigSchema.mockReturnValue(new Promise(() => undefined));
    mocks.readAppConfigForEdit.mockReturnValue(new Promise(() => undefined));
    renderEditor();
    expect(screen.getByRole("status").textContent).toContain("正在读取");
  });

  it("offers 可视化 and 高级 tabs when both modes are supported", async () => {
    renderEditor();
    await waitForLoaded();
    expect(screen.getByRole("tab", { name: "可视化" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "高级" })).toBeTruthy();
  });

  it("hides the tabs and shows the advanced mode when only advanced is supported", async () => {
    mocks.getAppConfigSchema.mockResolvedValue({ ...SCHEMA, visualSupported: false });
    renderEditor();
    await waitForLoaded();
    expect(screen.queryByRole("tab", { name: "可视化" })).toBeNull();
    expect(screen.getByLabelText("原始内容")).toBeTruthy();
  });

  it("shows a read failure with its reason and a retry action", async () => {
    mocks.readAppConfigForEdit
      .mockRejectedValueOnce({ code: "INTERNAL", message: "读取超时。", retryable: true })
      .mockResolvedValueOnce(READ);
    renderEditor();
    expect((await screen.findByRole("alert")).textContent).toContain("读取超时。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitForLoaded();
    expect(mocks.readAppConfigForEdit).toHaveBeenCalledTimes(2);
  });

  it("explains that saving creates a missing file", async () => {
    renderEditor(entry({}, { status: "notFound" }));
    await waitForLoaded();
    expect(screen.getByText("文件还不存在，保存时会创建它。")).toBeTruthy();
  });
});

describe("AppConfigEditor 可视化模式", () => {
  it("renders schema fields with labels, values, and status text", async () => {
    renderEditor();
    await waitForLoaded();
    expect((screen.getByLabelText("提交作者名") as HTMLInputElement).value).toBe("Archie");
    expect(screen.getByText("已设置")).toBeTruthy();
    expect(screen.getByText("未设置")).toBeTruthy();
  });

  it("never pre-fills a sensitive field and says its value is hidden", async () => {
    renderEditor();
    await waitForLoaded();
    expect((screen.getByLabelText("访问令牌") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("已设置（值已隐藏）")).toBeTruthy();
  });

  it("shows the allowed range next to a numeric field and validates before previewing", async () => {
    renderEditor();
    await waitForLoaded();
    expect(screen.getByText("允许范围：1 到 8")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("缩进宽度"), { target: { value: "12" } });
    expect(screen.getByText("超出允许范围（1 到 8）。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    expect(mocks.previewAppConfigEdit).not.toHaveBeenCalled();
  });

  it("removes a present key by sending null for that field only", async () => {
    renderEditor();
    await waitForLoaded();
    const row = screen.getByLabelText("提交作者名").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "移除" }));
    expect(screen.getByText("将移除")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    await waitFor(() => expect(mocks.previewAppConfigEdit).toHaveBeenCalledTimes(1));
    expect(mocks.previewAppConfigEdit.mock.calls[0][0]).toMatchObject({
      id: "git-config",
      mode: "fields",
      changes: [{ path: "user.name", value: null }],
      expectedHash: "hash-1",
    });
  });
});

describe("AppConfigEditor 预览、确认与冲突", () => {
  it("previews only the touched fields, then confirms with the preview token", async () => {
    const { onSaved } = renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));

    expect(await screen.findByText("确认写入")).toBeTruthy();
    expect(mocks.previewAppConfigEdit.mock.calls[0][0].changes).toEqual([
      { path: "user.name", value: "Bo" },
    ]);
    expect(screen.getByText(/备份原文件/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认写入" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false));
    expect(mocks.confirmAppConfigEdit).toHaveBeenCalledWith("token-1");
  });

  it("says a missing file is created without a backup", async () => {
    const { onSaved } = renderEditor(entry({}, { status: "notFound" }));
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    expect(await screen.findByText("文件还不存在，保存时会创建它，不需要备份。")).toBeTruthy();
    expect(screen.queryByText(/保存前会备份原文件/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认写入" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(true));
  });

  it("does not write anything when the preview is cancelled", async () => {
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    await screen.findByText("确认写入");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByText("确认写入")).toBeNull());
    expect(mocks.confirmAppConfigEdit).not.toHaveBeenCalled();
  });

  it("tells the user the file changed and offers a fresh read on CONFLICT", async () => {
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    await screen.findByText("确认写入");
    mocks.confirmAppConfigEdit.mockRejectedValueOnce({
      code: "CONFLICT",
      message: "文件已变化。",
      retryable: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "确认写入" }));

    expect(
      await screen.findByText("文件已被其他程序修改，请重新读取后再编辑。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(mocks.readAppConfigForEdit).toHaveBeenCalledTimes(2));
  });

  it("shows server-side errors inline and does not open the confirmation", async () => {
    mocks.previewAppConfigEdit.mockResolvedValue({
      ok: false,
      errors: [{ path: "user.name", message: "格式不正确。" }],
      diff: "",
      warnings: [],
      previewToken: null,
    });
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    expect(await screen.findByText("格式不正确。")).toBeTruthy();
    expect(screen.queryByText("确认写入")).toBeNull();
  });
});

describe("AppConfigEditor 高级模式", () => {
  it("shows the raw text in a monospace editor and reports syntax errors with line numbers", async () => {
    mocks.previewAppConfigEdit.mockResolvedValue({
      ok: false,
      errors: [{ line: 2, message: "缺少右括号。" }],
      diff: "",
      warnings: [],
      previewToken: null,
    });
    mocks.getAppConfigSchema.mockResolvedValue({ ...SCHEMA, visualSupported: false });
    renderEditor();
    await waitForLoaded();
    const area = screen.getByLabelText("原始内容") as HTMLTextAreaElement;
    expect(area.value).toBe(READ.rawText);
    fireEvent.change(area, { target: { value: "[user\n" } });
    fireEvent.click(screen.getByRole("button", { name: "预览更改" }));
    expect(await screen.findByText("第 2 行：缺少右括号。")).toBeTruthy();
  });

  it("hides the editor and keeps only 返回查看 when the raw text is blocked", async () => {
    mocks.readAppConfigForEdit.mockResolvedValue({
      ...READ,
      rawText: null,
      rawBlockedReason: "文件含有敏感值，原文不能在此编辑。",
    });
    mocks.getAppConfigSchema.mockResolvedValue({ ...SCHEMA, visualSupported: false });
    renderEditor();
    expect(await screen.findByText("文件含有敏感值，原文不能在此编辑。")).toBeTruthy();
    expect(screen.queryByLabelText("原始内容")).toBeNull();
    expect(screen.queryByRole("button", { name: "预览更改" })).toBeNull();
    expect(screen.getByRole("button", { name: "返回查看" })).toBeTruthy();
  });

  it("asks for confirmation before switching tabs with unsaved changes", async () => {
    renderEditor();
    await waitForLoaded();
    fireEvent.change(screen.getByLabelText("提交作者名"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("tab", { name: "高级" }));
    expect(await screen.findByText("切换会放弃当前模式未保存的修改")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "留在当前模式" }));
    expect((screen.getByLabelText("提交作者名") as HTMLInputElement).value).toBe("Bo");
  });

  it("keeps a clean tab's draft across switches without asking", async () => {
    renderEditor();
    await waitForLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "高级" }));
    expect(await screen.findByLabelText("原始内容")).toBeTruthy();
    expect(screen.queryByText("切换会放弃当前模式未保存的修改")).toBeNull();
  });
});
