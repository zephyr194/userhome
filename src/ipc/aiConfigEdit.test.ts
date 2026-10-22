import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  confirmClaudeEdit,
  decodeClaudeEditCatalog,
  decodeClaudeEditPreview,
  decodeClaudeEditResult,
  getClaudeEditCatalog,
  previewClaudeEdit,
  type ClaudeEditRequest,
} from "./aiConfig";

afterEach(() => {
  clearMocks();
});

const OPERATION_ID = "op-1";

const CATALOG_TEXT = {
  verifiedVersion: null,
  description: "Model to use for the session.",
  descriptionTruncated: false,
  defaultNote: "未设置时由 CLI 决定",
  sourceUrl: "https://code.claude.com/docs/en/settings-reference",
  sourceRetrievedOn: "2026-10-21",
};

function itemWire(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    keyPath: "alwaysThinkingEnabled",
    valueType: "boolean",
    allowedValues: [],
    editable: false,
    reason: "仅展示，版本未核实",
    ...CATALOG_TEXT,
    ...overrides,
  };
}

function catalogWire(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    detectedVersion: "2.1.287",
    items: [itemWire()],
    ...overrides,
  };
}

const REQUEST: ClaudeEditRequest = {
  grantId: "11111111-1111-4111-8111-111111111111",
  keyPath: "effortLevel",
  action: "set",
  value: "high",
};

function previewWire(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operationId: OPERATION_ID,
    summary: "Replace ~/.claude/settings.json.",
    effects: ["Target: ~/.claude/settings.json"],
    expiresAt: "2026-10-21T10:00:00Z",
    keyPath: "effortLevel",
    action: "set",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    diff: {
      lines: [
        { kind: "REMOVED", text: '"effortLevel": "low"' },
        { kind: "ADDED", text: '"effortLevel": "high"' },
      ],
      redacted: false,
      truncated: false,
    },
    reloadNote: "已写入设置文件。",
    ...overrides,
  };
}

function resultWire(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operationId: OPERATION_ID,
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      summary: "Replace ~/.claude/settings.json.",
    },
    reloadNote: "已写入设置文件。",
    ...overrides,
  };
}

describe("decodeClaudeEditCatalog", () => {
  it("decodes items with their editability and reasons", () => {
    const catalog = decodeClaudeEditCatalog(catalogWire());

    expect(catalog.detectedVersion).toBe("2.1.287");
    expect(catalog.items[0]).toEqual({
      keyPath: "alwaysThinkingEnabled",
      valueType: "boolean",
      allowedValues: [],
      editable: false,
      reason: "仅展示，版本未核实",
      verifiedVersion: null,
      description: "Model to use for the session.",
      descriptionTruncated: false,
      defaultNote: "未设置时由 CLI 决定",
      sourceUrl: "https://code.claude.com/docs/en/settings-reference",
      sourceRetrievedOn: "2026-10-21",
    });
  });

  it("accepts an editable item only without a reason", () => {
    const catalog = decodeClaudeEditCatalog(
      catalogWire({ items: [itemWire({ editable: true, reason: null })] }),
    );

    expect(catalog.items[0].editable).toBe(true);
  });

  it("rejects an editable item that still carries a reason, or a blocked item without one", () => {
    expect(() =>
      decodeClaudeEditCatalog(
        catalogWire({ items: [itemWire({ editable: true })] }),
      ),
    ).toThrow();
    expect(() =>
      decodeClaudeEditCatalog(
        catalogWire({ items: [itemWire({ reason: null })] }),
      ),
    ).toThrow();
  });

  it("rejects an unknown extra key on any object and an unknown value type", () => {
    expect(() => decodeClaudeEditCatalog(catalogWire({ extra: 1 }))).toThrow();
    expect(() =>
      decodeClaudeEditCatalog(catalogWire({ items: [itemWire({ extra: 1 })] })),
    ).toThrow();
    expect(() =>
      decodeClaudeEditCatalog(
        catalogWire({ items: [itemWire({ valueType: "float" })] }),
      ),
    ).toThrow();
  });

  it("rejects a non-object response", () => {
    expect(() => decodeClaudeEditCatalog(null)).toThrow();
    expect(() => decodeClaudeEditCatalog("catalog")).toThrow();
  });
});

describe("decodeClaudeEditPreview", () => {
  it("decodes a preview that echoes the requested key and action", () => {
    const preview = decodeClaudeEditPreview(previewWire(), REQUEST);

    expect(preview.operationId).toBe(OPERATION_ID);
    expect(preview.kind).toBe("REPLACE");
    expect(preview.recoveryPoint).toBe("BACKUP");
    expect(preview.diff.lines.map((line) => line.kind)).toEqual([
      "REMOVED",
      "ADDED",
    ]);
  });

  it("rejects a preview for another key or another action", () => {
    expect(() =>
      decodeClaudeEditPreview(previewWire({ keyPath: "language" }), REQUEST),
    ).toThrow();
    expect(() =>
      decodeClaudeEditPreview(
        previewWire({ action: "restoreDefault" }),
        REQUEST,
      ),
    ).toThrow();
  });

  it("rejects unknown enums, extra keys and oversized diff lines", () => {
    expect(() =>
      decodeClaudeEditPreview(previewWire({ kind: "APPEND" }), REQUEST),
    ).toThrow();
    expect(() =>
      decodeClaudeEditPreview(previewWire({ extra: true }), REQUEST),
    ).toThrow();
    expect(() =>
      decodeClaudeEditPreview(
        previewWire({
          diff: {
            lines: [{ kind: "ADDED", text: "x".repeat(2001) }],
            redacted: false,
            truncated: false,
          },
        }),
        REQUEST,
      ),
    ).toThrow();
  });

  it("accepts a redacted diff with no lines", () => {
    const preview = decodeClaudeEditPreview(
      previewWire({ diff: { lines: [], redacted: true, truncated: false } }),
      REQUEST,
    );

    expect(preview.diff.redacted).toBe(true);
  });
});

describe("decodeClaudeEditResult", () => {
  it("decodes a successful write without optional backup or error fields", () => {
    const result = decodeClaudeEditResult(resultWire(), OPERATION_ID);

    expect(result.outcome.status).toBe("SUCCEEDED");
    expect(result.outcome.backupId).toBeNull();
    expect(result.outcome.error).toBeNull();
  });

  it("decodes a failed write with its structured error", () => {
    const result = decodeClaudeEditResult(
      resultWire({
        outcome: {
          kind: "REPLACE",
          status: "FAILED",
          fileState: "RESTORED",
          recoveryPoint: "BACKUP",
          summary: "Replace ~/.claude/settings.json.",
          error: {
            code: "CONFLICT",
            message: "文件已被修改，请重新预览。",
            retryable: false,
          },
        },
      }),
      OPERATION_ID,
    );

    expect(result.outcome.status).toBe("FAILED");
    expect(result.outcome.fileState).toBe("RESTORED");
    expect(result.outcome.error?.code).toBe("CONFLICT");
  });

  it("rejects a result for another operation and an unknown file state", () => {
    expect(() => decodeClaudeEditResult(resultWire(), "other-op")).toThrow();
    expect(() =>
      decodeClaudeEditResult(
        resultWire({
          outcome: {
            kind: "REPLACE",
            status: "SUCCEEDED",
            fileState: "MAYBE",
            recoveryPoint: "BACKUP",
            summary: "x",
          },
        }),
        OPERATION_ID,
      ),
    ).toThrow();
  });
});

describe("Claude edit commands", () => {
  it("loads the catalog through the argument-free command", async () => {
    let captured: string | undefined;
    mockIPC((command) => {
      captured = command;
      return catalogWire();
    });

    await getClaudeEditCatalog();

    expect(captured).toBe("ai_config_claude_edit_catalog");
  });

  it("sends only the grant id, key and value for a set preview", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return previewWire();
    });

    await previewClaudeEdit(REQUEST);

    expect(captured?.command).toBe("ai_config_claude_preview_edit");
    expect(captured?.payload).toEqual({
      input: {
        grantId: REQUEST.grantId,
        keyPath: "effortLevel",
        action: "set",
        value: "high",
      },
    });
  });

  it("sends no value for restore-default and set-null previews", async () => {
    const payloads: unknown[] = [];
    mockIPC((_command, payload) => {
      payloads.push(payload);
      const action = (payload as { input: { action: string } }).input.action;
      return previewWire({ action });
    });

    await previewClaudeEdit({
      grantId: REQUEST.grantId,
      keyPath: "effortLevel",
      action: "setNull",
    });
    await previewClaudeEdit({
      grantId: REQUEST.grantId,
      keyPath: "effortLevel",
      action: "restoreDefault",
    });

    expect(payloads[0]).toEqual({
      input: {
        grantId: REQUEST.grantId,
        keyPath: "effortLevel",
        action: "setNull",
      },
    });
    expect(payloads[1]).toEqual({
      input: {
        grantId: REQUEST.grantId,
        keyPath: "effortLevel",
        action: "restoreDefault",
      },
    });
  });

  it("confirms by operation and grant id only", async () => {
    let captured: unknown;
    mockIPC((_command, payload) => {
      captured = payload;
      return resultWire();
    });

    await confirmClaudeEdit({
      operationId: OPERATION_ID,
      grantId: REQUEST.grantId,
    });

    expect(captured).toEqual({
      input: { operationId: OPERATION_ID, grantId: REQUEST.grantId },
    });
  });

  it("surfaces an expired or stale preview as a rejected error", async () => {
    mockIPC(() => {
      throw {
        code: "CONFLICT",
        message: "预览已过期，请重新预览。",
        retryable: false,
      };
    });

    await expect(
      confirmClaudeEdit({
        operationId: OPERATION_ID,
        grantId: REQUEST.grantId,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "预览已过期，请重新预览。",
    });
  });
});

describe("decodeClaudeEditCatalog official text and source", () => {
  it("decodes the official description, default note, truncation flag and source", () => {
    const catalog = decodeClaudeEditCatalog(
      catalogWire({
        items: [
          itemWire({
            ...CATALOG_TEXT,
            descriptionTruncated: true,
            verifiedVersion: "2.1.287",
          }),
        ],
      }),
    );

    expect(catalog.items[0]).toMatchObject({
      description: "Model to use for the session.",
      descriptionTruncated: true,
      verifiedVersion: "2.1.287",
      defaultNote: "未设置时由 CLI 决定",
      sourceUrl: "https://code.claude.com/docs/en/settings-reference",
      sourceRetrievedOn: "2026-10-21",
    });
  });

  it("rejects an item that omits any of the new fields", () => {
    for (const key of Object.keys(CATALOG_TEXT)) {
      const wire = itemWire({ ...CATALOG_TEXT });
      delete wire[key];
      expect(() =>
        decodeClaudeEditCatalog(catalogWire({ items: [wire] })),
      ).toThrow();
    }
  });

  it("counts description length in code points and rejects anything over 200", () => {
    const atLimit = "😀".repeat(200);
    const decoded = decodeClaudeEditCatalog(
      catalogWire({ items: [itemWire({ ...CATALOG_TEXT, description: atLimit })] }),
    );
    expect(decoded.items[0].description).toBe(atLimit);

    expect(() =>
      decodeClaudeEditCatalog(
        catalogWire({
          items: [itemWire({ ...CATALOG_TEXT, description: "😀".repeat(201) })],
        }),
      ),
    ).toThrow();
  });

  it("rejects empty or control-character text, a non-https source and a malformed retrieval date", () => {
    const rejected: Record<string, unknown>[] = [
      { description: "   " },
      { description: "line\nbreak" },
      { defaultNote: "" },
      { sourceUrl: "http://code.claude.com/docs" },
      { sourceRetrievedOn: "2026-10-21T00:00:00Z" },
      { descriptionTruncated: "false" },
      { verifiedVersion: 2 },
      { verifiedVersion: "" },
    ];
    for (const overrides of rejected) {
      expect(() =>
        decodeClaudeEditCatalog(
          catalogWire({ items: [itemWire({ ...CATALOG_TEXT, ...overrides })] }),
        ),
      ).toThrow();
    }
  });
});
