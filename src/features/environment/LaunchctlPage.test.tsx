// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { LaunchctlPage } from "./LaunchctlPage";

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("LaunchctlPage", () => {
  it("reads the login session variables through IPC and shows the names", async () => {
    mockIPC((command) => {
      expect(command).toBe("read_launchctl_environment");
      return {
        entries: [{ key: "PATH", value: "/usr/bin:/bin", secret: false }],
        readAt: "2026-10-22T09:30:00+08:00",
        partial: false,
      };
    });

    render(<LaunchctlPage />);

    expect(await screen.findByText("PATH")).toBeTruthy();
    expect(screen.getByText("/usr/bin:/bin")).toBeTruthy();
  });

  it("shows the reason and a retry when the read fails", async () => {
    mockIPC(() => Promise.reject({ code: "INTERNAL", message: "读取超时", retryable: true }));

    render(<LaunchctlPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("原因：读取超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("replaces the list with the result of a change without a loading state", async () => {
    const readAt = "2026-10-22T09:30:00+08:00";
    const commands: string[] = [];
    mockIPC((command, payload) => {
      commands.push(command);
      if (command === "read_launchctl_environment") {
        return { entries: [{ key: "PATH", value: "/usr/bin:/bin", secret: false }], readAt, partial: false };
      }
      if (command === "preview_launchctl_set") {
        expect(payload).toEqual({ key: "EDITOR", value: "vim" });
        return { key: "EDITOR", currentExists: false, currentSecret: false, expectedCurrent: null };
      }
      if (command === "execute_launchctl_set") {
        expect(payload).toEqual({ key: "EDITOR", value: "vim", expectedCurrent: null });
        return {
          entries: [
            { key: "EDITOR", value: "vim", secret: false },
            { key: "PATH", value: "/usr/bin:/bin", secret: false },
          ],
          readAt,
          partial: false,
          note: "此设置只影响之后启动的应用，注销或重启后失效。",
        };
      }
      throw new Error(`unexpected command ${command}`);
    });

    render(<LaunchctlPage />);
    await screen.findByText("PATH");

    fireEvent.click(screen.getByRole("button", { name: "设置变量" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("变量名"), { target: { value: "EDITOR" } });
    fireEvent.change(within(dialog).getByLabelText("值"), { target: { value: "vim" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "预览设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认设置" }));

    expect(await screen.findByText("EDITOR")).toBeTruthy();
    expect(screen.queryByText("正在读取登录会话的环境变量…")).toBeNull();
    expect(screen.getByText(/已设置 EDITOR。此设置只影响之后启动的应用/)).toBeTruthy();
    await waitFor(() => expect(commands[commands.length - 1]).toBe("execute_launchctl_set"));
    expect(commands.filter((command) => command === "read_launchctl_environment")).toHaveLength(1);
  });
});
