// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

    expect(await screen.findByRole("rowheader", { name: "PATH" })).toBeTruthy();
    expect(screen.getByText("/usr/bin:/bin")).toBeTruthy();
  });

  it("shows the reason and a retry when the read fails", async () => {
    mockIPC(() => Promise.reject({ code: "INTERNAL", message: "读取超时", retryable: true }));

    render(<LaunchctlPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("原因：读取超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
