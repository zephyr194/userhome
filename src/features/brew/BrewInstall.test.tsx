import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { executeBrewAction, previewBrewAction } from "../../ipc/brew";

describe("BrewInstall", () => {
  it("keeps install preview intent bound through mocked IPC", async () => {
    mockIPC((command, payload) => {
      if (command === "preview_brew_action") {
        expect(payload).toEqual({
          input: {
            action: "INSTALL",
            kind: "FORMULA",
            identifier: "caddy",
          },
        });
        return {
          operationId: "install-caddy",
          summary: "Install Formula caddy.",
          effects: ["Package identifier: caddy"],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        };
      }
      expect(command).toBe("execute_brew_action");
      expect(payload).toEqual({ operationId: "install-caddy" });
      return {
        operationId: "install-caddy",
        summary: "Install Formula caddy.",
        effects: ["Package identifier: caddy"],
        requiresElevation: false,
        expiresAt: "2026-09-20T12:00:00Z",
        status: "SUCCEEDED",
        events: [],
      };
    });

    const preview = await previewBrewAction({
      action: "INSTALL",
      kind: "FORMULA",
      identifier: "caddy",
    });
    await expect(executeBrewAction(preview.operationId)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
  });
});
