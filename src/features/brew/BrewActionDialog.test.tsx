import { mockIPC } from "@tauri-apps/api/mocks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  executeBrewAction,
  previewBrewAction,
  type BrewPackageAction,
} from "../../ipc/brew";
import { BrewActionDialog } from "./BrewActionDialog";

describe("BrewActionDialog", () => {
  it("shows the exact destructive package effect before confirmation", () => {
    const markup = renderToStaticMarkup(
      <BrewActionDialog
        preview={{
          operationId: "remove-caddy",
          summary: "Uninstall Formula caddy.",
          effects: [
            "Package kind: Formula",
            "Package identifier: caddy",
            "Remove the selected package and its Homebrew-managed files.",
          ],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        }}
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Uninstall Formula caddy");
    expect(markup).toContain("Package identifier: caddy");
    expect(markup).toContain("无需管理员权限");
  });

  it("keeps install upgrade and uninstall as separate mocked operations", async () => {
    const actions: BrewPackageAction[] = [
      "INSTALL",
      "UPGRADE",
      "UNINSTALL",
    ];
    let operation = 0;
    mockIPC((command, payload) => {
      if (command === "preview_brew_action") {
        operation += 1;
        const input = (payload as { input: { action: BrewPackageAction } }).input;
        return {
          operationId: `${input.action.toLowerCase()}-${operation}`,
          summary: `${input.action} Formula caddy.`,
          effects: [`Action: ${input.action}`],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        };
      }
      return {
        operationId: (payload as { operationId: string }).operationId,
        summary: "Completed package action.",
        effects: [],
        requiresElevation: false,
        expiresAt: "2026-09-20T12:00:00Z",
        status: "SUCCEEDED",
        events: [],
      };
    });

    const operationIds = [];
    for (const action of actions) {
      const preview = await previewBrewAction({
        action,
        kind: "FORMULA",
        identifier: "caddy",
      });
      operationIds.push(preview.operationId);
      await expect(executeBrewAction(preview.operationId)).resolves.toMatchObject({
        status: "SUCCEEDED",
      });
    }

    expect(new Set(operationIds).size).toBe(3);
  });
});
