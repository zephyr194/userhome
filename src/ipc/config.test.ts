import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { previewStructuredConfigWrite, readConfig } from "./config";

describe("config IPC", () => {
  it("decodes adapter fields and redacted raw content", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_config");
      expect(payload).toEqual({
        key: { appId: "npm", configId: "npm-user-config" },
      });
      return {
        appId: "npm",
        configId: "npm-user-config",
        displayPath: "~/.npmrc",
        format: "INI",
        sensitivity: "SECRET",
        writePolicy: "STRUCTURED_AND_RAW",
        exists: true,
        entryKind: "FILE",
        sizeBytes: 42,
        mode: 384,
        contentHash: "a".repeat(64),
        content: "//registry.npmjs.org/:_authToken=[REDACTED]\n",
        contentRedacted: true,
        structured: {
          registry: "https://registry.npmjs.org/",
          hasAuthToken: true,
        },
      };
    });

    await expect(readConfig("npm", "npm-user-config")).resolves.toMatchObject({
      contentRedacted: true,
      structured: { hasAuthToken: true },
    });
  });

  it("sends structured fields through the dedicated preview command", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_structured_config_write");
      expect(payload).toEqual({
        input: {
          appId: "git",
          configId: "git-global-config",
          expectedHash: "before",
          fields: { userName: "Example" },
        },
      });
      return {
        operationId: "op-1",
        summary: "Update git configuration.",
        effects: ["Apply only allowlisted structured fields."],
        requiresElevation: false,
        expiresAt: "2026-09-20T11:00:00Z",
        currentHash: "before",
        proposedHash: "after",
        diff: { lines: [], redacted: true, truncated: false },
      };
    });

    await expect(
      previewStructuredConfigWrite({
        appId: "git",
        configId: "git-global-config",
        expectedHash: "before",
        fields: { userName: "Example" },
      }),
    ).resolves.toMatchObject({ operationId: "op-1", proposedHash: "after" });
  });
});
