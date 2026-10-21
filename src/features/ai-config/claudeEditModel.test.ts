import { describe, expect, it } from "vitest";
import type {
  ClaudeEditItem,
  ClaudeEditPreview,
  ClaudeEditResult,
} from "../../ipc/aiConfig";
import {
  buildEditRequest,
  diffSymbol,
  editBlockedReason,
  editControl,
  editReducer,
  initialDraft,
  recoveryNote,
  resultMessage,
  type EditPhase,
} from "./claudeEditModel";

const GRANT = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<ClaudeEditItem> = {}): ClaudeEditItem {
  return {
    keyPath: "effortLevel",
    valueType: "enum",
    allowedValues: ["low", "medium", "high", "xhigh"],
    editable: true,
    reason: null,
    ...overrides,
  };
}

const PREVIEW: ClaudeEditPreview = {
  operationId: "op-1",
  summary: "Replace ~/.claude/settings.json.",
  effects: [],
  expiresAt: "2026-10-21T10:00:00Z",
  keyPath: "effortLevel",
  action: "set",
  kind: "REPLACE",
  recoveryPoint: "BACKUP",
  diff: { lines: [], redacted: false, truncated: false },
  reloadNote: "已写入设置文件。",
};

function result(
  status: "SUCCEEDED" | "FAILED",
  overrides: Partial<ClaudeEditResult["outcome"]> = {},
): ClaudeEditResult {
  return {
    operationId: "op-1",
    reloadNote: "已写入设置文件。",
    outcome: {
      kind: "REPLACE",
      status,
      fileState: status === "SUCCEEDED" ? "WRITTEN" : "RESTORED",
      recoveryPoint: "BACKUP",
      backupId: null,
      summary: "Replace ~/.claude/settings.json.",
      error: null,
      ...overrides,
    },
  };
}

describe("editControl and initialDraft", () => {
  it("chooses a control only for editable items of a supported type", () => {
    expect(editControl(item({ valueType: "boolean", allowedValues: [] }))).toBe(
      "boolean",
    );
    expect(editControl(item())).toBe("enum");
    expect(editControl(item({ valueType: "string", allowedValues: [] }))).toBe(
      "string",
    );
    expect(editControl(item({ editable: false, reason: "仅展示" }))).toBe(
      "none",
    );
    expect(editControl(item({ valueType: "object", allowedValues: [] }))).toBe(
      "none",
    );
  });

  it("starts each control from a neutral draft", () => {
    expect(
      initialDraft(item({ valueType: "boolean", allowedValues: [] })),
    ).toBe(false);
    expect(initialDraft(item())).toBe("low");
    expect(initialDraft(item({ valueType: "string", allowedValues: [] }))).toBe(
      "",
    );
  });
});

describe("editBlockedReason", () => {
  it("explains a display-only key with its own reason", () => {
    expect(
      editBlockedReason(
        item({ editable: false, reason: "版本未确认，写入已禁用" }),
        GRANT,
      ),
    ).toBe("版本未确认，写入已禁用");
  });

  it("asks for a settings file before any editable key can be changed", () => {
    expect(editBlockedReason(item(), null)).toBe(
      "请先选择要修改的用户设置文件。",
    );
    expect(editBlockedReason(item(), GRANT)).toBeNull();
  });
});

describe("buildEditRequest", () => {
  it("builds a set request with the typed value", () => {
    expect(buildEditRequest(item(), GRANT, "set", "high")).toEqual({
      ok: true,
      request: {
        grantId: GRANT,
        keyPath: "effortLevel",
        action: "set",
        value: "high",
      },
    });
  });

  it("rejects a draft that does not match the control", () => {
    expect(buildEditRequest(item(), GRANT, "set", "max").ok).toBe(false);
    expect(
      buildEditRequest(
        item({ valueType: "boolean", allowedValues: [] }),
        GRANT,
        "set",
        "true",
      ).ok,
    ).toBe(false);
  });

  it("rejects blank or over-long text", () => {
    const text = item({ valueType: "string", allowedValues: [] });

    expect(buildEditRequest(text, GRANT, "set", "   ").ok).toBe(false);
    expect(buildEditRequest(text, GRANT, "set", "a".repeat(257)).ok).toBe(
      false,
    );
    expect(buildEditRequest(text, GRANT, "set", "fr").ok).toBe(true);
  });

  it("keeps restore-default and set-null distinct and free of a value", () => {
    const restore = buildEditRequest(item(), GRANT, "restoreDefault", "high");
    const nulled = buildEditRequest(item(), GRANT, "setNull", "high");

    expect(restore).toEqual({
      ok: true,
      request: {
        grantId: GRANT,
        keyPath: "effortLevel",
        action: "restoreDefault",
      },
    });
    expect(nulled).toEqual({
      ok: true,
      request: { grantId: GRANT, keyPath: "effortLevel", action: "setNull" },
    });
  });
});

describe("editReducer", () => {
  it("walks preview, confirmation and a successful save", () => {
    let phase: EditPhase = { status: "idle" };
    phase = editReducer(phase, { type: "previewStart", action: "set" });
    phase = editReducer(phase, { type: "previewReady", preview: PREVIEW });
    phase = editReducer(phase, { type: "confirmStart" });
    phase = editReducer(phase, {
      type: "confirmDone",
      result: result("SUCCEEDED"),
    });

    expect(phase.status).toBe("saved");
  });

  it("reports a write that did not succeed as a write failure, not a save", () => {
    const phase = editReducer(
      { status: "confirming", preview: PREVIEW },
      { type: "confirmDone", result: result("FAILED") },
    );

    expect(phase.status).toBe("writeFailed");
  });

  it("drops the preview and shows the error when a confirmation is rejected as expired", () => {
    const expired = {
      code: "CONFLICT" as const,
      message: "预览已过期，请重新预览。",
      retryable: false,
    };
    const phase = editReducer(
      { status: "confirming", preview: PREVIEW },
      { type: "failed", error: expired },
    );

    expect(phase).toEqual({ status: "failed", error: expired });
  });

  it("ignores confirmation without a preview and a second preview while one is running", () => {
    expect(editReducer({ status: "idle" }, { type: "confirmStart" })).toEqual({
      status: "idle",
    });
    const running: EditPhase = { status: "previewing", action: "set" };
    expect(
      editReducer(running, { type: "previewStart", action: "setNull" }),
    ).toBe(running);
  });

  it("returns to idle when the user cancels a preview", () => {
    expect(
      editReducer(
        { status: "previewed", preview: PREVIEW },
        { type: "cancel" },
      ),
    ).toEqual({ status: "idle" });
  });

  it("does not accept a preview result after the request was cancelled", () => {
    const idle: EditPhase = { status: "idle" };
    expect(editReducer(idle, { type: "previewReady", preview: PREVIEW })).toBe(
      idle,
    );
  });
});

describe("display helpers", () => {
  it("marks added and removed lines", () => {
    expect(diffSymbol({ kind: "ADDED", text: "x" })).toBe("+");
    expect(diffSymbol({ kind: "REMOVED", text: "x" })).toBe("-");
  });

  it("says when there is no restore point and when a backup protects the write", () => {
    expect(
      recoveryNote({
        ...PREVIEW,
        kind: "CREATE",
        recoveryPoint: "NONE_CREATED",
      }),
    ).toContain("没有恢复点");
    expect(recoveryNote(PREVIEW)).toContain("备份");
  });

  it("reports success with the reload note and failure with the backend message", () => {
    expect(resultMessage(result("SUCCEEDED"))).toBe("已保存。已写入设置文件。");
    expect(
      resultMessage(
        result("FAILED", {
          error: {
            code: "CONFLICT",
            message: "文件已被修改，请重新预览。",
            retryable: false,
          },
        }),
      ),
    ).toBe("文件已被修改，请重新预览。");
  });
});
