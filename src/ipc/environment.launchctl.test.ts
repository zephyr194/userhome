import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeLaunchctlEnvironment,
  readLaunchctlEnvironment,
  revealLaunchctlValue,
} from "./environment";

const READ_AT = "2026-10-22T09:30:00+08:00";

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
});
