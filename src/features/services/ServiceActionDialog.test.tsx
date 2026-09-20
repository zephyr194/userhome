import { mockIPC } from "@tauri-apps/api/mocks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  executeServiceAction,
  previewServiceAction,
  type ServiceAction,
} from "../../ipc/services";
import { ServiceActionDialog } from "./ServiceActionDialog";

describe("ServiceActionDialog", () => {
  it("renders a distinct user-level preview", () => {
    const markup = renderToStaticMarkup(
      <ServiceActionDialog
        preview={{
          operationId: "restart-caddy",
          summary: "Restart user-level Caddy service.",
          effects: ["Action: restart", "Refresh and require STARTED state."],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        }}
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(markup).toContain("Restart user-level Caddy service");
    expect(markup).toContain("不使用提权");
  });

  it("runs a mocked preview-confirm-result flow", async () => {
    mockIPC((command, payload) => {
      if (command === "preview_service_action") {
        expect(payload).toEqual({
          input: { action: "START", serviceId: "caddy" },
        });
        return {
          operationId: "start-caddy",
          summary: "Start user-level Caddy service.",
          effects: ["Action: start"],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        };
      }
      expect(command).toBe("execute_service_action");
      return {
        operationId: "start-caddy",
        summary: "Start user-level Caddy service.",
        effects: ["Action: start"],
        requiresElevation: false,
        expiresAt: "2026-09-20T12:00:00Z",
        status: "SUCCEEDED",
        events: [],
      };
    });

    const preview = await previewServiceAction({
      action: "START",
      serviceId: "caddy",
    });
    await expect(
      executeServiceAction(preview.operationId),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
  });

  it("uses separate operation ids for start stop and restart", async () => {
    const actions: ServiceAction[] = ["START", "STOP", "RESTART"];
    let operation = 0;
    mockIPC((command, payload) => {
      if (command === "preview_service_action") {
        operation += 1;
        const input = (payload as { input: { action: ServiceAction } }).input;
        return {
          operationId: `${input.action.toLowerCase()}-${operation}`,
          summary: `${input.action} user-level Caddy service.`,
          effects: [`Action: ${input.action}`],
          requiresElevation: false,
          expiresAt: "2026-09-20T12:00:00Z",
        };
      }
      return {
        operationId: (payload as { operationId: string }).operationId,
        summary: "Completed service action.",
        effects: [],
        requiresElevation: false,
        expiresAt: "2026-09-20T12:00:00Z",
        status: "SUCCEEDED",
        events: [],
      };
    });

    const operationIds = [];
    for (const action of actions) {
      const preview = await previewServiceAction({
        action,
        serviceId: "caddy",
      });
      operationIds.push(preview.operationId);
      await expect(
        executeServiceAction(preview.operationId),
      ).resolves.toMatchObject({ status: "SUCCEEDED" });
    }

    expect(new Set(operationIds).size).toBe(3);
  });
});
