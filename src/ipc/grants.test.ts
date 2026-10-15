import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { decodeGrantSummary, listGrants, revokeGrant } from "./grants";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

function wireGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    purpose: "CONFIG_DIRECTORY",
    kind: "DIRECTORY",
    displayPath: "~/.config/tool",
    createdAtEpochMs: 1_760_000_000_000,
    ...overrides,
  };
}

afterEach(() => {
  clearMocks();
});

describe("grants IPC", () => {
  it("lists and decodes grant summaries", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("list_grants");
      expect(payload).toEqual({});
      return [wireGrant()];
    });

    await expect(listGrants()).resolves.toEqual([wireGrant()]);
  });

  it("drops fields the contract does not define", () => {
    expect(
      decodeGrantSummary(wireGrant({ path: "/Users/someone/.config/tool" })),
    ).toEqual(wireGrant());
  });

  it.each([
    ["a non-array list", { grants: [] }],
    ["a malformed id", [wireGrant({ id: "../../etc/passwd" })]],
    ["an unknown purpose", [wireGrant({ purpose: "ROOT_SHELL" })]],
    ["an unknown kind", [wireGrant({ kind: "SOCKET" })]],
    ["a purpose and kind mismatch", [wireGrant({ kind: "FILE" })]],
    ["an empty display path", [wireGrant({ displayPath: "" })]],
    ["a control character", [wireGrant({ displayPath: "~/a\nb" })]],
    ["a fractional timestamp", [wireGrant({ createdAtEpochMs: 1.5 })]],
    ["a negative timestamp", [wireGrant({ createdAtEpochMs: -1 })]],
  ])("rejects %s with an internal error", async (_label, response) => {
    mockIPC(() => response);

    await expect(listGrants()).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("sends only the grant id when revoking", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("revoke_grant");
      expect(payload).toEqual({ input: { grantId: GRANT_ID } });
      return null;
    });

    await expect(revokeGrant(GRANT_ID)).resolves.toBeUndefined();
  });

  it("refuses to send anything that is not a grant id", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return null;
    });

    await expect(revokeGrant("/Users/someone/.ssh")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(called).toBe(false);
  });

  it("rejects unexpected revoke payloads and decodes backend errors", async () => {
    mockIPC(() => ({ revoked: true }));
    await expect(revokeGrant(GRANT_ID)).rejects.toMatchObject({
      code: "INTERNAL",
    });

    mockIPC(() => {
      throw {
        code: "NOT_FOUND",
        message: "The authorization does not exist or was revoked.",
        retryable: false,
        path: "/Users/someone/secret",
      };
    });
    await expect(revokeGrant(GRANT_ID)).rejects.toEqual({
      code: "NOT_FOUND",
      message: "The authorization does not exist or was revoked.",
      retryable: false,
    });
  });
});
