import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeLaunchctlChange,
  decodeLaunchctlEnvironment,
  decodeLaunchctlSetPreview,
  previewLaunchctlSet,
  readLaunchctlEnvironment,
  revealLaunchctlValue,
  setLaunchctlValue,
  unsetLaunchctlValue,
} from "./environment";

const READ_AT = "2026-10-22T09:30:00+08:00";
const DIGEST = "a".repeat(64);
const NOTE = "此设置只影响之后启动的应用，注销或重启后失效。";

function wireEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    entries: [
      { key: "PATH", value: "/usr/bin:/bin", secret: false },
      { key: "API_TOKEN", value: null, secret: true },
    ],
    readAt: READ_AT,
    partial: false,
    ...overrides,
  };
}

afterEach(() => {
  clearMocks();
});

describe("launchctl environment IPC", () => {
  it("reads with no arguments and decodes the entries", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("read_launchctl_environment");
      expect(payload).toEqual({});
      return wireEnvironment();
    });

    const environment = await readLaunchctlEnvironment();

    expect(environment).toEqual({
      entries: [
        { key: "PATH", value: "/usr/bin:/bin", secret: false },
        { key: "API_TOKEN", value: null, secret: true },
      ],
      readAt: READ_AT,
      partial: false,
    });
  });

  it("accepts an empty list and a partial read", () => {
    expect(
      decodeLaunchctlEnvironment(wireEnvironment({ entries: [], partial: true })),
    ).toEqual({ entries: [], readAt: READ_AT, partial: true });
  });

  it("keeps a non-secret value that is empty", () => {
    const environment = decodeLaunchctlEnvironment(
      wireEnvironment({
        entries: [{ key: "EMPTY", value: "", secret: false }],
      }),
    );
    expect(environment.entries[0]).toEqual({ key: "EMPTY", value: "", secret: false });
  });

  it("rejects a secret entry that carries its value", () => {
    expect(() =>
      decodeLaunchctlEnvironment(
        wireEnvironment({
          entries: [{ key: "API_TOKEN", value: "plain", secret: true }],
        }),
      ),
    ).toThrow();
  });

  it("rejects a non-secret entry without a text value", () => {
    expect(() =>
      decodeLaunchctlEnvironment(
        wireEnvironment({ entries: [{ key: "PATH", value: null, secret: false }] }),
      ),
    ).toThrow();
  });

  it("rejects unknown fields on the response and on an entry", () => {
    expect(() =>
      decodeLaunchctlEnvironment({ ...wireEnvironment(), extra: true }),
    ).toThrow();
    expect(() =>
      decodeLaunchctlEnvironment(
        wireEnvironment({
          entries: [{ key: "PATH", value: "x", secret: false, source: "gui" }],
        }),
      ),
    ).toThrow();
  });

  it("rejects wrong types and missing fields", () => {
    expect(() => decodeLaunchctlEnvironment(wireEnvironment({ partial: "no" }))).toThrow();
    expect(() => decodeLaunchctlEnvironment(wireEnvironment({ readAt: 1 }))).toThrow();
    expect(() => decodeLaunchctlEnvironment(wireEnvironment({ entries: {} }))).toThrow();
    expect(() => decodeLaunchctlEnvironment({ entries: [], partial: false })).toThrow();
    expect(() => decodeLaunchctlEnvironment(null)).toThrow();
  });

  it("rejects a variable name that is not a valid name", () => {
    expect(() =>
      decodeLaunchctlEnvironment(
        wireEnvironment({ entries: [{ key: "BAD KEY", value: "x", secret: false }] }),
      ),
    ).toThrow();
  });

  it("reveals one value by name and returns the text", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("reveal_launchctl_value");
      expect(payload).toEqual({ key: "API_TOKEN" });
      return { value: "s3cret" };
    });

    await expect(revealLaunchctlValue("API_TOKEN")).resolves.toBe("s3cret");
  });

  it("refuses to send an invalid name to the backend", async () => {
    mockIPC(() => {
      throw new Error("must not be called");
    });

    await expect(revealLaunchctlValue("bad name")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects a reveal response with extra fields", async () => {
    mockIPC(() => ({ value: "x", extra: 1 }));

    await expect(revealLaunchctlValue("PATH")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("previews a set with the name and value and decodes the state", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("preview_launchctl_set");
      expect(payload).toEqual({ key: "EDITOR", value: "vim" });
      return { key: "EDITOR", currentExists: false, currentSecret: false, expectedCurrent: null };
    });

    await expect(previewLaunchctlSet("EDITOR", "vim")).resolves.toEqual({
      key: "EDITOR",
      currentExists: false,
      currentSecret: false,
      expectedCurrent: null,
    });
  });

  it("decodes a preview of a secret that is already set", () => {
    expect(
      decodeLaunchctlSetPreview({
        key: "API_TOKEN",
        currentExists: true,
        currentSecret: true,
        expectedCurrent: DIGEST,
      }),
    ).toEqual({ key: "API_TOKEN", currentExists: true, currentSecret: true, expectedCurrent: DIGEST });
  });

  it("rejects a preview whose fields contradict each other", () => {
    const base = { key: "EDITOR", currentExists: true, currentSecret: false, expectedCurrent: DIGEST };
    const cases: unknown[] = [
      { ...base, currentExists: false, expectedCurrent: DIGEST },
      { ...base, currentExists: false, currentSecret: true, expectedCurrent: null },
      { ...base, expectedCurrent: null },
      { ...base, expectedCurrent: "plain-value" },
      { ...base, key: "BAD KEY" },
      { ...base, extra: true },
      { key: "EDITOR", currentExists: true, currentSecret: false },
      null,
    ];
    for (const value of cases) {
      expect(() => decodeLaunchctlSetPreview(value), JSON.stringify(value)).toThrow();
    }
  });

  it("sets a value with the digest from the preview and returns the new list with its note", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_launchctl_set");
      expect(payload).toEqual({ key: "EDITOR", value: "vim", expectedCurrent: DIGEST });
      return { ...wireEnvironment(), note: NOTE };
    });

    const change = await setLaunchctlValue({ key: "EDITOR", value: "vim", expectedCurrent: DIGEST });

    expect(change.note).toBe(NOTE);
    expect(change.entries).toHaveLength(2);
  });

  it("sends a null digest when the variable was not set at preview time", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_launchctl_set");
      expect(payload).toEqual({ key: "EDITOR", value: "vim", expectedCurrent: null });
      return { ...wireEnvironment(), note: NOTE };
    });

    await expect(
      setLaunchctlValue({ key: "EDITOR", value: "vim", expectedCurrent: null }),
    ).resolves.toMatchObject({ note: NOTE });
  });

  it("removes a variable by name only and decodes the change", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("execute_launchctl_unset");
      expect(payload).toEqual({ key: "EDITOR" });
      return { ...wireEnvironment(), note: "移除只影响之后启动的应用，已经运行的应用不受影响。" };
    });

    await expect(unsetLaunchctlValue("EDITOR")).resolves.toMatchObject({ partial: false });
  });

  it("refuses an invalid name, value or digest without calling the backend", async () => {
    mockIPC(() => {
      throw new Error("must not be called");
    });
    const tooLong = "A".repeat(129);
    const badName = ["", "1A", "A-B", "A B", tooLong];

    for (const key of badName) {
      await expect(previewLaunchctlSet(key, "x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(unsetLaunchctlValue(key)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        setLaunchctlValue({ key, value: "x", expectedCurrent: null }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(previewLaunchctlSet("EDITOR", "a\0b")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(previewLaunchctlSet("EDITOR", "é".repeat(2049))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      setLaunchctlValue({ key: "EDITOR", value: "x", expectedCurrent: "NOT-A-DIGEST" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("sends a value of exactly 4096 bytes to the backend", async () => {
    const commands: string[] = [];
    mockIPC((command) => {
      commands.push(command);
      return { key: "EDITOR", currentExists: false, currentSecret: false, expectedCurrent: null };
    });

    await expect(previewLaunchctlSet("EDITOR", "é".repeat(2048))).resolves.toMatchObject({
      key: "EDITOR",
    });
    expect(commands).toEqual(["preview_launchctl_set"]);
  });

  it("passes a refused change back as a conflict the caller can show", async () => {
    mockIPC(() =>
      Promise.reject({
        code: "CONFLICT",
        message: "这个变量在预览后已被修改。",
        retryable: false,
      }),
    );

    await expect(
      setLaunchctlValue({ key: "EDITOR", value: "vim", expectedCurrent: DIGEST }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a change response without a note or with extra fields", () => {
    expect(() => decodeLaunchctlChange(wireEnvironment())).toThrow();
    expect(() => decodeLaunchctlChange({ ...wireEnvironment(), note: NOTE, extra: 1 })).toThrow();
    expect(() => decodeLaunchctlChange({ ...wireEnvironment(), note: "" })).toThrow();
  });
});
