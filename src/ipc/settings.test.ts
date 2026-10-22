import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { getDiagnosticsReport } from "./settings";

afterEach(() => {
  clearMocks();
});

function diagnosticsWire(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAtEpochMs: 1_700_000_000_000,
    application: { name: "UserHome", version: "0.1.0" },
    system: { architecture: "arm64", macosVersion: "15.0.1" },
    catalog: {
      schemaVersion: 1,
      applicationCount: 12,
      managedDocumentCount: 30,
      serviceCount: 4,
    },
    refresh: { state: "COMPLETE", completedAtEpochMs: 1_700_000_000_500 },
    providers: [
      { id: "system", state: "HEALTHY" },
      { id: "homebrew", state: "UNAVAILABLE" },
      { id: "candidates", state: "PARTIAL" },
    ],
    preferences: {
      schemaVersion: 1,
      state: "VALIDATED",
      providerTimeoutPreset: "STANDARD",
    },
    reportText: "UserHome Diagnostics\nSchema: 1\n",
    ...overrides,
  };
}

describe("getDiagnosticsReport", () => {
  it("decodes a report that carries no helper section", async () => {
    mockIPC(() => diagnosticsWire());

    const report = await getDiagnosticsReport();

    expect(report.catalog.applicationCount).toBe(12);
    expect(report.providers[1]).toEqual({ id: "homebrew", state: "UNAVAILABLE" });
    expect(report).not.toHaveProperty("helper");
  });

  it("fails closed when a helper section is present", async () => {
    mockIPC(() =>
      diagnosticsWire({
        helper: {
          supported: true,
          signed: false,
          available: false,
          state: "REQUIRES_APPROVAL",
        },
      }),
    );

    await expect(getDiagnosticsReport()).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
