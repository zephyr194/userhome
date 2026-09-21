import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { getAppStatus } from "./core";
import {
  DEFAULT_USER_PREFERENCES,
  updatePreferences,
} from "./settings";

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

  describe("settings IPC", () => {
    it("sends only the typed preference patch and decodes the saved result", async () => {
      mockIPC((command, payload) => {
        expect(command).toBe("update_preferences");
        expect(payload).toEqual({ patch: { appearance: "DARK" } });

        return {
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            appearance: "DARK",
          },
          diagnostic: null,
        };
      });

      await expect(updatePreferences({ appearance: "DARK" })).resolves.toEqual({
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          appearance: "DARK",
        },
      });
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
