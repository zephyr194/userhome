import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  cancelOperation,
  decodeOperationDetails,
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
        expiresAt: "2026-09-20T09:05:00Z",
      }),
    ).toEqual({
      operationId: "op-1",
      summary: "Install Caddy",
      effects: ["Install formula caddy"],
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

  describe("cancellation states and bounded history", () => {
    const base = {
      operationId: "op-1",
      summary: "Stop service",
      effects: [],
      expiresAt: "2026-09-20T09:05:00Z",
      events: [],
    };

    it.each(["CANCELLING", "CANCELLED", "FAILED"])(
      "decodes the %s status",
      (status) => {
        expect(decodeOperationDetails({ ...base, status }).status).toBe(status);
      },
    );

    it("decodes a failed final event that carries the unconfirmed-exit error", () => {
      const event = decodeOperationEvent({
        type: "finished",
        operationId: "op-1",
        sequence: 3,
        status: "FAILED",
        error: {
          code: "PROCESS_FAILED",
          message: "The process exit could not be confirmed.",
          retryable: true,
        },
      });

      expect(event).toMatchObject({ type: "finished", status: "FAILED" });
    });

    it("decodes dropped event and record counts and omits them when absent", () => {
      expect(
        decodeOperationDetails({
          ...base,
          status: "SUCCEEDED",
          droppedEvents: 7,
          droppedRecords: 2,
        }),
      ).toMatchObject({ droppedEvents: 7, droppedRecords: 2 });

      const plain = decodeOperationDetails({ ...base, status: "SUCCEEDED" });
      expect(plain).not.toHaveProperty("droppedEvents");
      expect(plain).not.toHaveProperty("droppedRecords");
    });

    it("rejects unknown statuses and malformed counts", () => {
      expect(() =>
        decodeOperationDetails({ ...base, status: "TERMINATED" }),
      ).toThrow();
      expect(() =>
        decodeOperationDetails({
          ...base,
          status: "SUCCEEDED",
          droppedEvents: -1,
        }),
      ).toThrow();
      expect(() =>
        decodeOperationDetails({
          ...base,
          status: "SUCCEEDED",
          droppedRecords: "2",
        }),
      ).toThrow();
    });
  });
});
