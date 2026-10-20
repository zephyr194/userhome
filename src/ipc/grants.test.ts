import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeGrantStoreReset,
  decodeGrantStoreStatus,
  decodeGrantSummary,
  decodeSelectGrantResult,
  getGrantStoreStatus,
  grantPurposeLabel,
  listGrants,
  resetGrantStore,
  revokeGrant,
  selectDirectoryGrant,
  selectFileGrant,
  selectSaveLocationGrant,
  type FileGrantPurpose,
} from "./grants";

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

describe("native selection IPC", () => {
  it("selects a directory with only a purpose and decodes the summary", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("select_directory_grant");
      expect(payload).toEqual({ input: { purpose: "CONFIG_DIRECTORY" } });
      return { status: "SELECTED", grant: wireGrant() };
    });

    await expect(selectDirectoryGrant()).resolves.toEqual({
      status: "SELECTED",
      grant: wireGrant(),
    });
  });

  it.each<[FileGrantPurpose]>([["CONFIG_FILE"], ["EXECUTABLE"]])(
    "selects a %s file with only a purpose",
    async (purpose) => {
      const grant = wireGrant({ purpose, kind: "FILE", displayPath: "~/tool" });
      mockIPC((command, payload) => {
        expect(command).toBe("select_file_grant");
        expect(payload).toEqual({ input: { purpose } });
        return { status: "SELECTED", grant };
      });

      await expect(selectFileGrant(purpose)).resolves.toEqual({
        status: "SELECTED",
        grant,
      });
    },
  );

  it("selects a save location as a config file grant", async () => {
    const grant = wireGrant({ purpose: "CONFIG_FILE", kind: "FILE" });
    mockIPC((command, payload) => {
      expect(command).toBe("select_save_location_grant");
      expect(payload).toEqual({ input: { purpose: "CONFIG_FILE" } });
      return { status: "SELECTED", grant };
    });

    await expect(selectSaveLocationGrant()).resolves.toEqual({
      status: "SELECTED",
      grant,
    });
  });

  it("decodes a new-file grant for a save location that does not exist yet", async () => {
    // The backend grants parent directory plus file name; the summary keeps
    // the ordinary shape (a FILE grant with a display path) and carries no
    // absolute path or file-name field.
    const wire = wireGrant({
      purpose: "CONFIG_FILE",
      kind: "FILE",
      displayPath: "~/project/not-yet.json",
    });
    mockIPC((command, payload) => {
      expect(command).toBe("select_save_location_grant");
      expect(payload).toEqual({ input: { purpose: "CONFIG_FILE" } });
      return { status: "SELECTED", grant: wire };
    });

    const result = await selectSaveLocationGrant();

    expect(result).toEqual({ status: "SELECTED", grant: wire });
    expect(JSON.stringify(result)).not.toContain("/Users/");
  });

  it("decodes the same summary when a new-file grant is listed later", async () => {
    const wire = wireGrant({
      purpose: "CONFIG_FILE",
      kind: "FILE",
      displayPath: "~/project/not-yet.json",
    });
    mockIPC(() => [wire]);

    await expect(listGrants()).resolves.toEqual([wire]);
  });

  it("passes new-file selection failures through as typed app errors without paths", async () => {
    mockIPC(() => {
      throw {
        code: "NOT_FOUND",
        message: "The approved location no longer exists.",
        retryable: false,
        path: "/Users/someone/missing/not-yet.json",
      };
    });

    await expect(selectSaveLocationGrant()).rejects.toEqual({
      code: "NOT_FOUND",
      message: "The approved location no longer exists.",
      retryable: false,
    });
  });

  it("reports an explicit cancelled result rather than a grant", async () => {
    mockIPC(() => ({ status: "CANCELLED" }));

    await expect(selectDirectoryGrant()).resolves.toEqual({
      status: "CANCELLED",
    });
  });

  it("rejects an unsupported file purpose without calling the backend", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return null;
    });

    await expect(
      selectFileGrant("CONFIG_DIRECTORY" as FileGrantPurpose),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(called).toBe(false);
  });

  it("passes backend errors through as typed app errors", async () => {
    mockIPC(() => {
      throw {
        code: "CONFLICT",
        message: "A selection dialog is already open.",
        retryable: false,
      };
    });

    await expect(selectDirectoryGrant()).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it.each([
    ["a non-record", "SELECTED"],
    ["an unknown status", { status: "OK" }],
    ["a selection without a grant", { status: "SELECTED" }],
    [
      "a cancellation carrying a grant",
      { status: "CANCELLED", grant: wireGrant() },
    ],
    ["a bare grant", wireGrant()],
    [
      "a grant with another purpose",
      {
        status: "SELECTED",
        grant: wireGrant({ purpose: "EXECUTABLE", kind: "FILE" }),
      },
    ],
    [
      "a grant with a bad id",
      { status: "SELECTED", grant: wireGrant({ id: "../x" }) },
    ],
  ])("rejects %s with an internal error", async (_label, response) => {
    mockIPC(() => response);

    await expect(selectDirectoryGrant()).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("drops unknown fields such as a path from the selected grant", () => {
    expect(
      decodeSelectGrantResult(
        {
          status: "SELECTED",
          grant: wireGrant({ path: "/Users/someone/.config/tool" }),
        },
        "CONFIG_DIRECTORY",
      ),
    ).toEqual({ status: "SELECTED", grant: wireGrant() });
  });
});

describe("grant store status and reset IPC", () => {
  it("reads the store status without sending anything", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("get_grant_store_status");
      expect(payload).toEqual({});
      return { status: "UNAVAILABLE", reason: "NEWER_VERSION" };
    });

    await expect(getGrantStoreStatus()).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "NEWER_VERSION",
    });
  });

  it("decodes every status and reason", () => {
    expect(decodeGrantStoreStatus({ status: "AVAILABLE" })).toEqual({
      status: "AVAILABLE",
    });
    for (const reason of ["CORRUPT", "NEWER_VERSION", "NOT_REGULAR_FILE", "IO"]) {
      expect(decodeGrantStoreStatus({ status: "UNAVAILABLE", reason })).toEqual({
        status: "UNAVAILABLE",
        reason,
      });
    }
  });

  it.each([
    ["null", null],
    ["a string", "AVAILABLE"],
    ["an unknown status", { status: "BROKEN" }],
    ["a missing status", {}],
    ["an unavailable status without a reason", { status: "UNAVAILABLE" }],
    ["an unknown reason", { status: "UNAVAILABLE", reason: "ON_FIRE" }],
    ["a non-string reason", { status: "UNAVAILABLE", reason: 3 }],
    ["an available status with a reason", { status: "AVAILABLE", reason: "IO" }],
    ["an extra field", { status: "AVAILABLE", path: "/Users/x/grants.json" }],
  ])("rejects a malformed status: %s", async (_label, response) => {
    expect(() => decodeGrantStoreStatus(response)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
    mockIPC(() => response);
    await expect(getGrantStoreStatus()).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("resets with an empty input object and decodes the result", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("reset_grant_store");
      expect(payload).toEqual({ input: {} });
      return {
        quarantineFileName: "grants.json.corrupt-20261015T133000Z",
        previousReason: "CORRUPT",
      };
    });

    await expect(resetGrantStore()).resolves.toEqual({
      quarantineFileName: "grants.json.corrupt-20261015T133000Z",
      previousReason: "CORRUPT",
    });
  });

  it("accepts the numbered name used when the first one is taken", () => {
    expect(
      decodeGrantStoreReset({
        quarantineFileName: "grants.json.corrupt-20261015T133000Z-2",
        previousReason: "NEWER_VERSION",
      }),
    ).toEqual({
      quarantineFileName: "grants.json.corrupt-20261015T133000Z-2",
      previousReason: "NEWER_VERSION",
    });
  });

  it.each([
    ["null", null],
    ["a missing name", { previousReason: "CORRUPT" }],
    ["a non-string name", { quarantineFileName: 1, previousReason: "CORRUPT" }],
    [
      "a path instead of a name",
      {
        quarantineFileName: "/Users/x/grants.json.corrupt-1",
        previousReason: "CORRUPT",
      },
    ],
    [
      "a traversal",
      {
        quarantineFileName: "../grants.json.corrupt-1",
        previousReason: "CORRUPT",
      },
    ],
    [
      "a foreign file name",
      { quarantineFileName: "passwd", previousReason: "CORRUPT" },
    ],
    [
      "a control character",
      {
        quarantineFileName: "grants.json.corrupt-1\n",
        previousReason: "CORRUPT",
      },
    ],
    [
      "a reset reason that cannot be reset",
      {
        quarantineFileName: "grants.json.corrupt-1",
        previousReason: "NOT_REGULAR_FILE",
      },
    ],
    [
      "an extra field",
      {
        quarantineFileName: "grants.json.corrupt-1",
        previousReason: "CORRUPT",
        content: "{}",
      },
    ],
  ])("rejects a malformed reset result: %s", async (_label, response) => {
    expect(() => decodeGrantStoreReset(response)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
    mockIPC(() => response);
    await expect(resetGrantStore()).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("surfaces a reset refusal with its error code and message", async () => {
    mockIPC(() => {
      throw {
        code: "PARTIAL_FAILURE",
        message: "set aside as grants.json.corrupt-1, try again",
        retryable: true,
      };
    });

    await expect(resetGrantStore()).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      message: "set aside as grants.json.corrupt-1, try again",
    });
  });
});

describe("shell startup file grants", () => {
  const shellGrant = (overrides: Record<string, unknown> = {}) =>
    wireGrant({
      purpose: "SHELL_STARTUP_FILE",
      kind: "FILE",
      displayPath: "~/.zshrc",
      ...overrides,
    });

  it("decodes and lists a shell startup file grant instead of failing on the new purpose", async () => {
    expect(decodeGrantSummary(shellGrant())).toEqual(shellGrant());
    mockIPC(() => [wireGrant(), shellGrant({ id: "4f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b" })]);

    const grants = await listGrants();

    expect(grants.map((grant) => grant.purpose)).toEqual([
      "CONFIG_DIRECTORY",
      "SHELL_STARTUP_FILE",
    ]);
  });

  it("keeps the purpose and kind rule: a shell startup grant is a file grant", () => {
    expect(() => decodeGrantSummary(shellGrant({ kind: "DIRECTORY" }))).toThrow();
  });

  it("labels every purpose, the new one as a shell startup file", () => {
    expect(grantPurposeLabel("SHELL_STARTUP_FILE")).toBe("shell 启动文件");
    const labels = (["CONFIG_DIRECTORY", "CONFIG_FILE", "EXECUTABLE", "SHELL_STARTUP_FILE"] as const).map(
      grantPurposeLabel,
    );
    expect(new Set(labels).size).toBe(4);
  });

  it("never selects the purpose through a dialog and never calls the backend for it", async () => {
    let called = false;
    mockIPC(() => {
      called = true;
      return null;
    });

    await expect(
      selectFileGrant("SHELL_STARTUP_FILE" as FileGrantPurpose),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(called).toBe(false);
  });

  it("rejects a selection result that carries the purpose", () => {
    expect(() =>
      decodeSelectGrantResult(
        { status: "SELECTED", grant: shellGrant() },
        "CONFIG_FILE",
      ),
    ).toThrow();
  });
});
