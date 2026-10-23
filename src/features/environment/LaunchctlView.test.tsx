// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LaunchctlChange,
  LaunchctlEnvironment,
  LaunchctlSetPreview,
} from "../../ipc/environment";
import { LaunchctlView, type LaunchctlState } from "./LaunchctlView";

const READ_AT = "2026-10-22T09:30:00+08:00";
const NOTE = "此设置只影响之后启动的应用，注销或重启后失效。";
const DIGEST = "b".repeat(64);

const ENVIRONMENT: LaunchctlEnvironment = {
  entries: [
    { key: "PATH", value: "/usr/bin:/bin", secret: false },
    { key: "EMPTY_ONE", value: "", secret: false },
    { key: "API_TOKEN", value: null, secret: true },
  ],
  readAt: READ_AT,
  partial: false,
};

const ABSENT: LaunchctlSetPreview = {
  key: "EDITOR",
  currentExists: false,
  currentSecret: false,
  expectedCurrent: null,
};

function change(environment: LaunchctlEnvironment = ENVIRONMENT): LaunchctlChange {
  return { ...environment, note: NOTE };
}

function renderView(
  state: LaunchctlState,
  options: {
    onReveal?: (key: string) => Promise<string>;
    onRetry?: () => void;
    onPreview?: (key: string, value: string) => Promise<LaunchctlSetPreview>;
    onSet?: (input: { key: string; value: string; expectedCurrent: string | null }) => Promise<LaunchctlChange>;
    onUnset?: (key: string) => Promise<LaunchctlChange>;
  } = {},
) {
  const props = {
    onReveal: options.onReveal ?? vi.fn(async () => "s3cret"),
    onRetry: options.onRetry ?? vi.fn(),
    onPreview:
      options.onPreview ?? vi.fn(async (key: string) => ({ ...ABSENT, key })),
    onSet: options.onSet ?? vi.fn(async () => change()),
    onUnset: options.onUnset ?? vi.fn(async () => change()),
  };
  render(<LaunchctlView state={state} {...props} />);
  return props;
}

function openSetDialog() {
  fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
  return screen.getByRole("dialog");
}

function fillForm(name: string, value: string) {
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("变量名"), {
    target: { value: name },
  });
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("值"), {
    target: { value },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LaunchctlView", () => {
  it("names the domain, explains it, and shows when the list was read", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    expect(screen.getByRole("heading", { name: "macOS 登录会话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "说明：登录会话变量" })).toBeTruthy();
    expect(screen.getByText(`读取时间：${new Date(READ_AT).toLocaleString("zh-CN")}`)).toBeTruthy();
  });

  it("shows a placeholder while the list is loading and disables re-reading", () => {
    renderView({ status: "loading" });

    expect(screen.getByRole("status").textContent).toContain("正在读取登录会话的环境变量");
    expect(screen.getByRole("button", { name: "重新读取" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "设置变量" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains an empty session and what does not show up", () => {
    renderView({
      status: "ready",
      environment: { entries: [], readAt: READ_AT, partial: false },
    });

    expect(screen.getByText("登录会话里没有可见的环境变量。")).toBeTruthy();
    expect(screen.getByText(/终端里设置的变量不会出现/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the reason for a failed read and retries from the error block", () => {
    const { onRetry } = renderView({ status: "failed", message: "权限不足" });

    expect(screen.getByRole("alert").textContent).toContain("原因：权限不足");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("re-reads from the header button", () => {
    const { onRetry } = renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows plain values as text and marks an empty value", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    expect(screen.getByText("PATH")).toBeTruthy();
    expect(screen.getByText("/usr/bin:/bin")).toBeTruthy();
    expect(screen.getByText("（空值）")).toBeTruthy();
  });

  it("lists one row per variable, sorted by name, with the login session as its source", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    const table = screen.getByRole("table", { name: "登录会话的环境变量" });
    const names = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("code")?.textContent);
    expect(names).toEqual(["API_TOKEN", "EMPTY_ONE", "PATH"]);
    expect(within(table).getAllByText("登录会话（launchctl）")).toHaveLength(3);
  });

  it("masks a revealed secret again after the list is re-read", async () => {
    const props = {
      onReveal: vi.fn(async () => "s3cret"),
      onRetry: vi.fn(),
      onPreview: vi.fn(async (key: string) => ({ ...ABSENT, key })),
      onSet: vi.fn(async () => change()),
      onUnset: vi.fn(async () => change()),
    };
    const { rerender } = render(
      <LaunchctlView state={{ status: "ready", environment: ENVIRONMENT }} {...props} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));
    fireEvent.click(await screen.findByRole("button", { name: "显示 API_TOKEN 的值" }));
    expect(await screen.findByText("s3cret")).toBeTruthy();

    rerender(
      <LaunchctlView
        state={{ status: "ready", environment: { ...ENVIRONMENT, readAt: "2026-10-22T10:00:00+08:00" } }}
        {...props}
      />,
    );
    expect(screen.queryByText("s3cret")).toBeNull();
    expect(screen.getByRole("button", { name: "载入 API_TOKEN 的值" })).toBeTruthy();
  });

  it("keeps a secret masked until its value is loaded and shown on request", async () => {
    const { onReveal } = renderView({ status: "ready", environment: ENVIRONMENT });

    const row = screen.getByText("API_TOKEN").closest("tr");
    expect(row?.textContent).toContain("已隐藏，值尚未载入");
    expect(screen.queryByText("s3cret")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledWith("API_TOKEN"));
    fireEvent.click(await screen.findByRole("button", { name: "显示 API_TOKEN 的值" }));

    expect(await screen.findByText("s3cret")).toBeTruthy();
  });

  it("shows the reason when a secret value cannot be loaded", async () => {
    renderView(
      { status: "ready", environment: ENVIRONMENT },
      { onReveal: () => Promise.reject({ code: "INTERNAL", message: "读取失败", retryable: false }) },
    );

    fireEvent.click(screen.getByRole("button", { name: "载入 API_TOKEN 的值" }));

    expect((await screen.findByRole("status")).textContent).toContain("载入失败：读取失败");
    expect(screen.queryByText("s3cret")).toBeNull();
  });

  it("warns that the list may be incomplete after a partial read", () => {
    renderView({ status: "ready", environment: { ...ENVIRONMENT, partial: true } });

    expect(screen.getByText(/下面的列表可能不完整/)).toBeTruthy();
  });

  it("offers set, modify and remove actions for each row", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    expect(screen.getByRole("button", { name: "设置变量" })).toBeTruthy();
    for (const key of ["PATH", "EMPTY_ONE", "API_TOKEN"]) {
      expect(screen.getByRole("button", { name: `修改 ${key}` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `移除 ${key}` })).toBeTruthy();
    }
  });

  it("sets a new variable through preview and confirmation, then reports it", async () => {
    const props = renderView({ status: "ready", environment: ENVIRONMENT });

    const dialog = openSetDialog();
    expect(dialog.textContent).toContain("只影响之后启动的应用，注销或重启后失效。");
    fillForm("EDITOR", "vim");
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));

    await waitFor(() => expect(props.onPreview).toHaveBeenCalledWith("EDITOR", "vim"));
    const preview = await screen.findByRole("dialog");
    expect(preview.textContent).toContain("将设置 EDITOR");
    expect(preview.textContent).toContain("当前：未设置");
    expect(preview.textContent).not.toContain("vim");

    fireEvent.click(within(preview).getByRole("button", { name: "确认设置" }));

    await waitFor(() =>
      expect(props.onSet).toHaveBeenCalledWith({
        key: "EDITOR",
        value: "vim",
        expectedCurrent: null,
      }),
    );
    expect(await screen.findByText(`已设置 EDITOR。${NOTE}`)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when the variable is already set and masks a secret one", async () => {
    const onPreview = vi.fn(async (): Promise<LaunchctlSetPreview> => ({
      key: "API_TOKEN",
      currentExists: true,
      currentSecret: true,
      expectedCurrent: DIGEST,
    }));
    renderView({ status: "ready", environment: ENVIRONMENT }, { onPreview });

    fireEvent.click(screen.getByRole("button", { name: "修改 API_TOKEN" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("值"), {
      target: { value: "new" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "预览设置" }));

    expect(await screen.findByText("当前：已设置（已遮盖）")).toBeTruthy();
    expect(screen.getByText("将设置 API_TOKEN")).toBeTruthy();
  });

  it("confirms the name and value that were previewed, not what the form shows afterwards", async () => {
    let answer: (preview: LaunchctlSetPreview) => void = () => undefined;
    const onPreview = vi.fn(
      () => new Promise<LaunchctlSetPreview>((resolve) => { answer = resolve; }),
    );
    const props = renderView({ status: "ready", environment: ENVIRONMENT }, { onPreview });

    const dialog = openSetDialog();
    fillForm("EDITOR", "vim");
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith("EDITOR", "vim"));
    fillForm("OTHER", "nano");
    answer(ABSENT);

    const preview = await screen.findByRole("dialog");
    expect(preview.textContent).toContain("将设置 EDITOR");
    expect(preview.textContent).not.toContain("OTHER");
    expect(within(preview).queryByLabelText("变量名")).toBeNull();

    fireEvent.click(within(preview).getByRole("button", { name: "确认设置" }));
    await waitFor(() =>
      expect(props.onSet).toHaveBeenCalledWith({ key: "EDITOR", value: "vim", expectedCurrent: null }),
    );
  });

  it("previews again under a new name after returning to the form", async () => {
    const props = renderView({ status: "ready", environment: ENVIRONMENT });

    const dialog = openSetDialog();
    fillForm("EDITOR", "vim");
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "返回修改" }));
    fillForm("OTHER", "nano");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "预览设置" }));

    await waitFor(() => expect(props.onPreview).toHaveBeenLastCalledWith("OTHER", "nano"));
    expect((await screen.findByRole("dialog")).textContent).toContain("将设置 OTHER");
  });

  it("validates the name and the value before any preview is sent", () => {
    const { onPreview } = renderView({ status: "ready", environment: ENVIRONMENT });

    const dialog = openSetDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    expect(within(dialog).getByText("请输入变量名。")).toBeTruthy();
    expect(within(dialog).getByText("请输入值。要删除这个变量，请使用“移除”。")).toBeTruthy();

    fillForm("1ABC", "x");
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    expect(within(dialog).getByText(/变量名只能由字母、数字和下划线组成/)).toBeTruthy();

    fillForm("EDITOR", "a\0b");
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    expect(within(dialog).getByText("值不能包含空字符。")).toBeTruthy();

    expect(onPreview).not.toHaveBeenCalled();
  });

  it("opens a modify form with the name fixed and a plain value filled in", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "修改 PATH" }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText("变量名") as HTMLInputElement;
    const value = within(dialog).getByLabelText("值") as HTMLTextAreaElement;

    expect(name.value).toBe("PATH");
    expect(name.readOnly).toBe(true);
    expect(value.value).toBe("/usr/bin:/bin");
  });

  it("never prefills the value of a secret when modifying it", () => {
    renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "修改 API_TOKEN" }));
    const dialog = screen.getByRole("dialog");
    const value = within(dialog).getByLabelText("值") as HTMLTextAreaElement;

    expect(value.value).toBe("");
    expect(within(dialog).queryByText("abc123")).toBeNull();
  });

  it("returns to the form with the reason when the value changed after the preview", async () => {
    const onSet = vi.fn(async () =>
      Promise.reject({
        code: "CONFLICT",
        message: "这个变量在预览后已被修改。请重新预览，确认新的当前值后再设置。",
        retryable: false,
      }),
    );
    renderView({ status: "ready", environment: ENVIRONMENT }, { onSet });

    fireEvent.click(screen.getByRole("button", { name: "修改 PATH" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "预览设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认设置" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("这个变量在预览后已被修改。请重新预览");
    expect(within(screen.getByRole("dialog")).getByLabelText("值")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认设置" })).toBeNull();
  });

  it("keeps the preview open and shows the reason when the change fails", async () => {
    const onSet = vi.fn(async () =>
      Promise.reject({ code: "PROCESS_FAILED", message: "系统没有接受这次修改。", retryable: true }),
    );
    renderView({ status: "ready", environment: ENVIRONMENT }, { onSet });

    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    fillForm("EDITOR", "vim");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "预览设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认设置" }));

    expect((await screen.findByRole("alert")).textContent).toContain("系统没有接受这次修改。");
    expect(screen.getByRole("button", { name: "确认设置" })).toBeTruthy();
  });

  it("asks before removing a variable and removes it on confirmation", async () => {
    const props = renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "移除 PATH" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("将从登录会话中移除 PATH");

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(props.onUnset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "移除 PATH" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除变量" }));

    await waitFor(() => expect(props.onUnset).toHaveBeenCalledWith("PATH", null));
    expect(await screen.findByText(/已移除 PATH。/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes with the digest from a preview taken when the removal is confirmed", async () => {
    const onPreview = vi.fn(async (key: string) => ({
      key,
      currentExists: true,
      currentSecret: false,
      expectedCurrent: DIGEST,
    }));
    const props = renderView({ status: "ready", environment: ENVIRONMENT }, { onPreview });

    fireEvent.click(screen.getByRole("button", { name: "移除 PATH" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除变量" }));

    await waitFor(() => expect(props.onUnset).toHaveBeenCalledWith("PATH", DIGEST));
    expect(onPreview).toHaveBeenCalledWith("PATH", "");
  });

  it("removes a secret variable without needing its value", async () => {
    const props = renderView({ status: "ready", environment: ENVIRONMENT });

    fireEvent.click(screen.getByRole("button", { name: "移除 API_TOKEN" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除变量" }));

    await waitFor(() => expect(props.onUnset).toHaveBeenCalledWith("API_TOKEN", null));
  });

  it("keeps the removal dialog open with the reason when removing fails", async () => {
    const onUnset = vi.fn(async () =>
      Promise.reject({ code: "PROCESS_FAILED", message: "系统没有接受这次修改。", retryable: true }),
    );
    renderView({ status: "ready", environment: ENVIRONMENT }, { onUnset });

    fireEvent.click(screen.getByRole("button", { name: "移除 PATH" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除变量" }));

    expect((await screen.findByRole("alert")).textContent).toContain("系统没有接受这次修改。");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
