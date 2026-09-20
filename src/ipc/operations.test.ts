import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  cancelOperation,
  decodeOperationEvent,
  decodeOperationPreview,
} from "./operations";

describe("operation IPC", () => {
  it("decodes the approved operation preview contract", () => {
    expect(
      decodeOperationPreview({
        operationId: "op-1",
        summary: "Install Caddy",
        effects: ["Install formula caddy"],
        requiresElevation: false,
        expiresAt: "2026-09-20T09:05:00Z",
      }),
    ).toEqual({
      operationId: "op-1",
      summary: "Install Caddy",
      effects: ["Install formula caddy"],
      requiresElevation: false,
      expiresAt: "2026-09-20T09:05:00Z",
    });
  });

  it("decodes bounded progress and final event variants", () => {
    expect(
      decodeOperationEvent({
        type: "progress",
        operationId: "op-1",
        sequence: 1,
        message: "Downloading",
      }),
    ).toEqual({
      type: "progress",
      operationId: "op-1",
      sequence: 1,
      message: "Downloading",
    });

    expect(
      decodeOperationEvent({
        type: "finished",
        operationId: "op-1",
        sequence: 2,
        status: "SUCCEEDED",
        stdoutSummary: "Installed",
      }),
    ).toEqual({
      type: "finished",
      operationId: "op-1",
      sequence: 2,
      status: "SUCCEEDED",
      stdoutSummary: "Installed",
    });
  });

  it("invokes cancellation with an operation ID and decodes details", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("cancel_operation");
      expect(payload).toEqual({ operationId: "op-1" });

      return {
        operationId: "op-1",
        summary: "Install Caddy",
        effects: ["Install formula caddy"],
        requiresElevation: false,
        expiresAt: "2026-09-20T09:05:00Z",
        status: "CANCELLING",
        events: [],
      };
    });

    await expect(cancelOperation("op-1")).resolves.toMatchObject({
      operationId: "op-1",
      status: "CANCELLING",
    });
  });
});
