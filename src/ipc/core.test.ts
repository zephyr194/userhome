import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { getAppStatus } from "./core";

describe("getAppStatus", () => {
  it("decodes typed status responses", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("get_app_status");
      expect(payload).toEqual({});

      return {
        status: "ok",
        version: "0.1.0",
      };
    });

    await expect(getAppStatus()).resolves.toEqual({
      status: "ok",
      version: "0.1.0",
    });
  });

  it("decodes AppError responses without leaking extra fields", async () => {
    mockIPC(() => {
      throw {
        code: "INTERNAL",
        message: "An internal error occurred.",
        retryable: false,
        source: "token=secret",
        stack: "sensitive backtrace",
      };
    });

    await expect(getAppStatus()).rejects.toEqual({
      code: "INTERNAL",
      message: "An internal error occurred.",
      retryable: false,
    });
  });
});
