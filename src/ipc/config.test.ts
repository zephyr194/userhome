import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import {
  diagnoseConfig,
  listConfigs,
  previewStructuredConfigWrite,
  readConfig,
  resolveConfigVariants,
} from "./config";

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
        variantId: "primary",
        displayPath: "~/.npmrc",
        state: "REDACTED",
        retryable: false,
        nextAction: "VIEW_REDACTED",
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

  it("rejects an unknown runtime format instead of selecting a generic viewer", async () => {
    mockIPC(() => [
      {
        appId: "example",
        configId: "example-config",
        variantId: "primary",
        displayPath: "~/.config/example/config",
        state: "MISSING",
        retryable: false,
        nextAction: "CREATE_FILE",
        format: "BINARY",
        sensitivity: "STANDARD",
        writePolicy: "READ_ONLY",
        exists: false,
      },
    ]);

    await expect(listConfigs("example")).rejects.toMatchObject({
      code: "INTERNAL",
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

  it("decodes variant resolution and typed diagnostics", async () => {
    const summary = {
      appId: "starship",
      configId: "starship-config",
      format: "TOML",
      sensitivity: "SENSITIVE",
      writePolicy: "READ_ONLY",
      entryKind: null,
      sizeBytes: null,
      modifiedAtEpochMs: null,
      mode: null,
      contentHash: null,
      symlink: null,
    };
    mockIPC((command, payload) => {
      expect(payload).toEqual({
        key: { appId: "starship", configId: "starship-config" },
      });
      if (command === "resolve_config_variants") {
        return [
          {
            ...summary,
            variantId: "xdg",
            displayPath: "XDG_CONFIG_HOME/starship.toml",
            state: "MISSING",
            retryable: false,
            nextAction: "CREATE_FILE",
            exists: false,
            selected: true,
          },
        ];
      }
      expect(command).toBe("diagnose_config");
      return {
        appId: "starship",
        configId: "starship-config",
        variantId: "xdg",
        displayPath: "XDG_CONFIG_HOME/starship.toml",
        state: "MISSING",
        retryable: false,
        nextAction: "CREATE_FILE",
      };
    });

    await expect(
      resolveConfigVariants("starship", "starship-config"),
    ).resolves.toMatchObject([{ selected: true, state: "MISSING" }]);
    await expect(
      diagnoseConfig("starship", "starship-config"),
    ).resolves.toMatchObject({
      state: "MISSING",
      nextAction: "CREATE_FILE",
    });
  });
});
