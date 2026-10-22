import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  caddyCancelValidate,
  caddyConfirmExternalRawSave,
  caddyLoadRaw,
  caddyPreviewExternalRawSave,
  caddySaveRaw,
  caddyValidate,
  decodeExternalSavePreview,
  decodeRawDocument,
  decodeValidationReport,
} from "./caddy";

afterEach(() => {
  clearMocks();
});

const LIMITATION = "validate 会 provision（加载）配置中的模块";

function reportWire(overrides: Record<string, unknown> = {}) {
  return {
    status: "INVALID",
    stage: "ADAPT",
    externalReferences: [{ kind: "IMPORT", line: 1 }],
    diagnostics: [{ line: 2, message: "adapting config: Caddyfile:2: unknown directive" }],
    limitation: LIMITATION,
    ...overrides,
  };
}

function expectInternal(decode: () => unknown) {
  expect(decode).toThrow();
}

function previewWire(stepOverrides: Record<string, unknown> = {}) {
  return {
    batchId: "batch-1",
    atomic: false,
    note: "逐个确认",
    steps: [
      {
        operationId: "op-1",
        summary: "替换 Caddyfile",
        effects: [],
        expiresAt: "2026-10-21T00:05:00Z",
        kind: "REPLACE",
        recoveryPoint: "BACKUP",
        target: "Caddyfile",
        currentHash: "abc",
        proposedHash: "def",
        diff: { lines: [], redacted: false, truncated: false },
        ...stepOverrides,
      },
    ],
  };
}

describe("decodeValidationReport", () => {
  it("accepts a report with a stage and references", () => {
    expect(decodeValidationReport(reportWire())).toEqual({
      status: "INVALID",
      stage: "ADAPT",
      externalReferences: [{ kind: "IMPORT", line: 1 }],
      diagnostics: [{ line: 2, message: "adapting config: Caddyfile:2: unknown directive" }],
      limitation: LIMITATION,
    });
  });

  it("accepts a report without a stage", () => {
    const wire: Record<string, unknown> = { ...reportWire({ status: "EXTERNAL_REFERENCES" }) };
    delete wire.stage;
    expect(decodeValidationReport(wire).stage).toBeUndefined();
  });

  it("refuses unknown keys, statuses, stages and reference kinds", () => {
    expectInternal(() => decodeValidationReport({ ...reportWire(), path: "/x" }));
    expectInternal(() => decodeValidationReport(reportWire({ status: "STOPPED" })));
    expectInternal(() => decodeValidationReport(reportWire({ stage: "PARSE" })));
    expectInternal(() =>
      decodeValidationReport(reportWire({ externalReferences: [{ kind: "PATH", line: 1 }] })),
    );
  });

  it("refuses negative or fractional line numbers and an empty limitation", () => {
    expectInternal(() =>
      decodeValidationReport(reportWire({ externalReferences: [{ kind: "IMPORT", line: -1 }] })),
    );
    expectInternal(() =>
      decodeValidationReport(reportWire({ diagnostics: [{ line: 1.5, message: "x" }] })),
    );
    expectInternal(() => decodeValidationReport(reportWire({ limitation: "" })));
  });

  it("refuses a diagnostic that carries extra fields", () => {
    expectInternal(() =>
      decodeValidationReport(
        reportWire({ diagnostics: [{ message: "x", file: "/Users/someone/Caddyfile" }] }),
      ),
    );
  });
});

describe("decodeRawDocument", () => {
  it("accepts saved, empty and external origins", () => {
    expect(decodeRawDocument({ origin: "SAVED", text: "a" })).toEqual({
      origin: "SAVED",
      text: "a",
    });
    expect(decodeRawDocument({ origin: "EMPTY", text: "" }).origin).toBe("EMPTY");
    expect(
      decodeRawDocument({ origin: "EXTERNAL", text: "a", sha256: "abc" }).sha256,
    ).toBe("abc");
  });

  it("refuses unknown origins and extra keys such as a path", () => {
    expectInternal(() => decodeRawDocument({ origin: "PATH", text: "a" }));
    expectInternal(() => decodeRawDocument({ origin: "SAVED", text: "a", path: "/x" }));
  });
});

describe("decodeExternalSavePreview", () => {
  it("accepts a single-step batch and keeps the fields the UI uses", () => {
    expect(decodeExternalSavePreview(previewWire())).toEqual({
      batchId: "batch-1",
      operationId: "op-1",
      summary: "替换 Caddyfile",
      expiresAt: "2026-10-21T00:05:00Z",
      kind: "REPLACE",
      target: "Caddyfile",
      proposedHash: "def",
      currentHash: "abc",
    });
  });

  it("refuses batches that are not exactly one step", () => {
    expectInternal(() => decodeExternalSavePreview({ ...previewWire(), steps: [] }));
    const two = previewWire();
    expectInternal(() =>
      decodeExternalSavePreview({ ...two, steps: [...two.steps, ...two.steps] }),
    );
  });

  it("refuses an unknown write kind", () => {
    expectInternal(() => decodeExternalSavePreview(previewWire({ kind: "APPEND" })));
  });
});

describe("request bodies", () => {
  it("validate sends only the raw text, a run id and the explicit allow flag", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return reportWire({ status: "VALID", stage: "VALIDATE", diagnostics: [] });
    });

    await caddyValidate({
      text: "example.com {\n}\n",
      runId: "run-1",
      allowExternalReferences: false,
    });

    expect(captured?.command).toBe("caddy_validate");
    expect(captured?.payload).toEqual({
      input: {
        source: { kind: "raw", text: "example.com {\n}\n" },
        runId: "run-1",
        allowExternalReferences: false,
      },
    });
    expect(JSON.stringify(captured?.payload)).not.toMatch(/path|executablePath|\/Users/);
  });

  it("load sends no path and an empty input", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return { origin: "EMPTY", text: "" };
    });

    await caddyLoadRaw();

    expect(captured?.command).toBe("caddy_load_raw");
    expect(captured?.payload).toEqual({ input: {} });
  });

  it("save sends only the text", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return null;
    });

    await caddySaveRaw("# keep\n");

    expect(captured?.command).toBe("caddy_save_raw");
    expect(captured?.payload).toEqual({ input: { text: "# keep\n" } });
  });

  it("cancel sends the run id and reads the boolean answer", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return true;
    });

    await expect(caddyCancelValidate("run-1")).resolves.toBe(true);
    expect(captured?.payload).toEqual({ input: { runId: "run-1" } });
  });

  it("external preview sends a grant id and text, never a path", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return previewWire();
    });

    await caddyPreviewExternalRawSave("5f3b6e6e-0000-4000-8000-000000000001", "a\n");

    expect(captured?.command).toBe("caddy_preview_external_raw_save");
    const input = (captured?.payload as { input: Record<string, unknown> }).input;
    expect(Object.keys(input).sort()).toEqual(["expectedSha256", "grantId", "text"]);
    expect(JSON.stringify(captured?.payload)).not.toMatch(/path/i);
  });

  it("external confirm sends the operation id and grant id only", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return {
        operationId: "op-1",
        summary: "写入完成",
        status: "SUCCEEDED",
        outcome: { status: "SUCCEEDED", fileState: "WRITTEN" },
      };
    });

    const result = await caddyConfirmExternalRawSave(
      "5f3b6e6e-0000-4000-8000-000000000001",
      "op-1",
    );

    expect(captured?.command).toBe("caddy_confirm_external_raw_save");
    expect(captured?.payload).toEqual({
      input: { grantId: "5f3b6e6e-0000-4000-8000-000000000001", operationId: "op-1" },
    });
    expect(result.fileState).toBe("WRITTEN");
  });
});
