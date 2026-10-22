import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  caddyWorkdirRevoke,
  caddyWorkdirSelect,
  caddyWorkdirStatus,
  caddyWorkdirUseDefault,
  decodeWorkdirStatus,
  isWorkdirRequired,
} from "./caddy";
import type { AppError } from "./core";

afterEach(() => {
  clearMocks();
});

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

function wireGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    purpose: "CADDY_WORK_DIR",
    kind: "DIRECTORY",
    displayPath: "~/.caddy",
    createdAtEpochMs: 1_760_000_000_000,
    ...overrides,
  };
}

function wireStatus(overrides: Record<string, unknown> = {}) {
  return {
    authorized: wireGrant(),
    defaultDisplayPath: "~/.caddy",
    legacyDataPresent: false,
    ...overrides,
  };
}

function expectInternal(decode: () => unknown) {
  let thrown: unknown;
  try {
    decode();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toEqual({
    code: "INTERNAL",
    message: "An internal error occurred.",
    retryable: false,
  });
}

describe("caddy work directory status decoding", () => {
  it("decodes an unauthorized status without an authorization or legacy notice", () => {
    expect(
      decodeWorkdirStatus({
        authorized: null,
        defaultDisplayPath: "~/.caddy",
        legacyDataPresent: false,
      }),
    ).toEqual({ defaultDisplayPath: "~/.caddy", legacyDataPresent: false });
  });

  it("decodes an authorized status with a legacy data notice", () => {
    expect(
      decodeWorkdirStatus(
        wireStatus({
          legacyDataPresent: true,
          legacyDisplayPath: "~/Library/Application Support/UserHome/caddy",
        }),
      ),
    ).toEqual({
      authorized: {
        id: GRANT_ID,
        purpose: "CADDY_WORK_DIR",
        kind: "DIRECTORY",
        displayPath: "~/.caddy",
        createdAtEpochMs: 1_760_000_000_000,
      },
      defaultDisplayPath: "~/.caddy",
      legacyDataPresent: true,
      legacyDisplayPath: "~/Library/Application Support/UserHome/caddy",
    });
  });

  it("refuses unknown fields and a legacy path that does not match the flag", () => {
    expectInternal(() => decodeWorkdirStatus({ ...wireStatus(), extra: true }));
    expectInternal(() => decodeWorkdirStatus(wireStatus({ legacyDisplayPath: "~/old" })));
    expectInternal(() => decodeWorkdirStatus(wireStatus({ legacyDataPresent: true })));
  });

  it("refuses an authorization that is not a Caddy work directory", () => {
    expectInternal(() => decodeWorkdirStatus(wireStatus({ authorized: wireGrant({ purpose: "CONFIG_DIRECTORY" }) })));
    expectInternal(() => decodeWorkdirStatus(wireStatus({ authorized: wireGrant({ kind: "FILE" }) })));
  });

  it("refuses malformed paths and missing fields", () => {
    expectInternal(() => decodeWorkdirStatus(wireStatus({ defaultDisplayPath: "" })));
    expectInternal(() => decodeWorkdirStatus(wireStatus({ defaultDisplayPath: "~/a\nb" })));
    expectInternal(() => decodeWorkdirStatus(wireStatus({ defaultDisplayPath: "x".repeat(1025) })));
    expectInternal(() => decodeWorkdirStatus({ defaultDisplayPath: "~/.caddy", legacyDataPresent: false }));
    expectInternal(() => decodeWorkdirStatus(null));
  });
});

describe("caddy work directory commands", () => {
  it("reads the status through its command", async () => {
    mockIPC((command) => {
      expect(command).toBe("caddy_workdir_status");
      return wireStatus({ authorized: null });
    });

    await expect(caddyWorkdirStatus()).resolves.toEqual({
      defaultDisplayPath: "~/.caddy",
      legacyDataPresent: false,
    });
  });

  it("returns a cancelled picker without a grant", async () => {
    mockIPC((command) => {
      expect(command).toBe("caddy_workdir_select");
      return { status: "CANCELLED" };
    });

    await expect(caddyWorkdirSelect()).resolves.toEqual({ status: "CANCELLED" });
  });

  it("returns the selected Caddy work directory grant", async () => {
    mockIPC(() => ({ status: "SELECTED", grant: wireGrant() }));

    await expect(caddyWorkdirSelect()).resolves.toEqual({
      status: "SELECTED",
      grant: {
        id: GRANT_ID,
        purpose: "CADDY_WORK_DIR",
        kind: "DIRECTORY",
        displayPath: "~/.caddy",
        createdAtEpochMs: 1_760_000_000_000,
      },
    });
  });

  it("sends the confirmation with the default directory request only", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("caddy_workdir_use_default");
      expect(payload).toEqual({ input: { confirmed: true } });
      return { status: "SELECTED", grant: wireGrant() };
    });

    await expect(caddyWorkdirUseDefault()).resolves.toMatchObject({ status: "SELECTED" });
  });

  it("rejects a selection result that carries another purpose", async () => {
    mockIPC(() => ({ status: "SELECTED", grant: wireGrant({ purpose: "CONFIG_DIRECTORY" }) }));

    await expect(caddyWorkdirUseDefault()).rejects.toEqual({
      code: "INTERNAL",
      message: "An internal error occurred.",
      retryable: false,
    });
  });

  it("revokes without a payload and accepts an empty response", async () => {
    mockIPC((command) => {
      expect(command).toBe("caddy_workdir_revoke");
      return null;
    });

    await expect(caddyWorkdirRevoke()).resolves.toBeUndefined();
  });

  it("surfaces the backend message of a failed selection", async () => {
    mockIPC(() => {
      throw { code: "PERMISSION_DENIED", message: "受保护目录不能用作工作目录。", retryable: false };
    });

    await expect(caddyWorkdirSelect()).rejects.toEqual({
      code: "PERMISSION_DENIED",
      message: "受保护目录不能用作工作目录。",
      retryable: false,
    });
  });
});

describe("workdir_required conflict", () => {
  const required: AppError = {
    code: "CONFLICT",
    message: "需要先选择工作目录，未保存、校验或开启任何 Caddy 配置。",
    details: { reason: "workdir_required" },
    retryable: false,
  };

  it("recognizes the structured conflict", () => {
    expect(isWorkdirRequired(required)).toBe(true);
  });

  it("does not treat other conflicts or errors as a missing work directory", () => {
    expect(isWorkdirRequired({ ...required, details: { reason: "other" } })).toBe(false);
    expect(isWorkdirRequired({ ...required, code: "INVALID_INPUT" })).toBe(false);
    expect(isWorkdirRequired({ code: "CONFLICT", message: "x", retryable: false })).toBe(false);
  });
});
