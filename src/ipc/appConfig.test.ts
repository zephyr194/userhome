import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  decodeAppConfigList,
  decodeAppConfigReadResult,
  isAppConfigId,
  listAppConfigEntries,
  readAppConfigEntry,
} from "./appConfig";

afterEach(() => {
  clearMocks();
});

function summaryWire(overrides: Record<string, unknown> = {}) {
  return {
    id: "zed-settings",
    name: "Zed 设置",
    category: "editor",
    displayPath: "~/.config/zed/settings.json",
    format: "jsonc",
    capability: "readOnly",
    sensitivity: "sensitiveKeys",
    metadataOnly: false,
    sourceUrl: "https://zed.dev/docs/configuring-zed",
    verifiedOn: "2026-10-16",
    ...overrides,
  };
}

function itemWire(
  summary: Record<string, unknown> = {},
  probe: Record<string, unknown> = { status: "notFound" },
) {
  return { summary: summaryWire(summary), probe };
}

function contentWire(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "content",
    view: {
      text: "{\n  \"theme\": \"One\"\n}\n",
      redacted: true,
      withheldLines: 1,
      warnings: [{ line: 4, message: "无法识别的行，内容未显示" }],
      ...overrides,
    },
  };
}

describe("decodeAppConfigList", () => {
  it("decodes every probe status and keeps the summary fields", () => {
    const items = decodeAppConfigList([
      itemWire({}, { status: "found", size: 120, modifiedUnixMillis: 1_700_000_000_000 }),
      itemWire({ id: "npmrc", sensitivity: "credentials", capability: "discoverOnly" }, { status: "notFound" }),
      itemWire({ id: "tmux-conf" }, { status: "symlinkOrNonRegular" }),
      itemWire({ id: "git-config-home" }, { status: "inaccessible" }),
      itemWire({ id: "ssh-system-config", category: "system" }, { status: "outOfBounds" }),
    ]);

    expect(items.map((item) => item.probe.status)).toEqual([
      "found",
      "notFound",
      "symlinkOrNonRegular",
      "inaccessible",
      "outOfBounds",
    ]);
    expect(items[0]).toEqual({
      summary: summaryWire(),
      probe: { status: "found", size: 120, modifiedUnixMillis: 1_700_000_000_000 },
    });
  });

  it("accepts an empty registry listing", () => {
    expect(decodeAppConfigList([])).toEqual([]);
  });

  it.each([
    ["a non-array payload", { items: [] }],
    ["a null item", [null]],
    ["a missing summary", [{ probe: { status: "notFound" } }]],
    ["a missing probe", [{ summary: summaryWire() }]],
    ["an unknown category", [itemWire({ category: "browser" })]],
    ["an unknown format", [itemWire({ format: "yaml" })]],
    ["an unknown capability", [itemWire({ capability: "writeable" })]],
    ["an unknown sensitivity", [itemWire({ sensitivity: "secret" })]],
    ["a missing name", [itemWire({ name: undefined })]],
    ["a blank display path", [itemWire({ displayPath: "   " })]],
    ["a non-boolean metadataOnly", [itemWire({ metadataOnly: "no" })]],
    ["a missing sourceUrl", [itemWire({ sourceUrl: undefined })]],
    ["an id that is not kebab-case", [itemWire({ id: "Zed_Settings" })]],
    ["an id that looks like a path", [itemWire({ id: "/Users/me/.zshrc" })]],
    ["an unknown probe status", [itemWire({}, { status: "exists" })]],
    ["a found probe without a size", [itemWire({}, { status: "found", modifiedUnixMillis: 1 })]],
    ["a negative size", [itemWire({}, { status: "found", size: -1, modifiedUnixMillis: 1 })]],
    ["a fractional modification time", [itemWire({}, { status: "found", size: 1, modifiedUnixMillis: 1.5 })]],
  ])("fails closed on %s", (_label, payload) => {
    expect(() => decodeAppConfigList(payload)).toThrow();
  });

  it("fails closed with the internal error shape", () => {
    let thrown: unknown;
    try {
      decodeAppConfigList("oops");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "INTERNAL" });
  });
});

describe("decodeAppConfigReadResult", () => {
  it("decodes the content view with its warnings", () => {
    expect(decodeAppConfigReadResult(contentWire())).toEqual({
      outcome: "content",
      view: {
        text: "{\n  \"theme\": \"One\"\n}\n",
        redacted: true,
        withheldLines: 1,
        warnings: [{ line: 4, message: "无法识别的行，内容未显示" }],
      },
    });
  });

  it("decodes metadata-only results without content", () => {
    expect(
      decodeAppConfigReadResult({
        outcome: "metadataOnly",
        meta: { size: 42, modifiedUnixMillis: 1_700_000_000_000 },
      }),
    ).toEqual({
      outcome: "metadataOnly",
      meta: { size: 42, modifiedUnixMillis: 1_700_000_000_000 },
    });
  });

  it("decodes an unavailable status but never a found one", () => {
    expect(
      decodeAppConfigReadResult({ outcome: "unavailable", status: { status: "inaccessible" } }),
    ).toEqual({ outcome: "unavailable", status: { status: "inaccessible" } });
    expect(() =>
      decodeAppConfigReadResult({
        outcome: "unavailable",
        status: { status: "found", size: 1, modifiedUnixMillis: 1 },
      }),
    ).toThrow();
  });

  it.each(["tooLarge", "parseError", "unreadable"])("decodes read failure %s", (kind) => {
    expect(decodeAppConfigReadResult({ outcome: "failed", kind })).toEqual({
      outcome: "failed",
      kind,
    });
  });

  it.each([
    ["an unknown outcome", { outcome: "partial" }],
    ["an unknown failure kind", { outcome: "failed", kind: "denied" }],
    ["a content result without a view", { outcome: "content" }],
    ["a content view without a boolean redacted flag", contentWire({ redacted: "yes" })],
    ["a warning without a line", contentWire({ warnings: [{ message: "x" }] })],
    ["a missing outcome", { view: {} }],
  ])("fails closed on %s", (_label, payload) => {
    expect(() => decodeAppConfigReadResult(payload)).toThrow();
  });
});

describe("listAppConfigEntries", () => {
  it("invokes the list command without arguments and decodes the response", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return [itemWire()];
    });

    const items = await listAppConfigEntries();

    expect(captured?.command).toBe("app_config_list");
    expect(items).toHaveLength(1);
  });

  it("surfaces a malformed list payload as an internal error", async () => {
    mockIPC(() => [{ summary: { id: "zed-settings" } }]);

    await expect(listAppConfigEntries()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("readAppConfigEntry", () => {
  it("sends only the registry id, never a path", async () => {
    let captured: { command: string; payload: unknown } | undefined;
    mockIPC((command, payload) => {
      captured = { command, payload };
      return contentWire();
    });

    await readAppConfigEntry("zed-settings");

    expect(captured).toEqual({
      command: "app_config_read",
      payload: { id: "zed-settings" },
    });
  });

  it.each([
    "",
    "Zed-Settings",
    "zed settings",
    "/Users/me/.config/zed/settings.json",
    "~/.gitconfig",
    "../etc/passwd",
    "zed-settings/../x",
  ])("refuses %j before invoking the backend", async (id) => {
    let invoked = false;
    mockIPC(() => {
      invoked = true;
      return contentWire();
    });

    await expect(readAppConfigEntry(id)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      retryable: false,
    });
    expect(invoked).toBe(false);
  });

  it("maps a backend not-found error to the typed app error", async () => {
    mockIPC(() => {
      throw { code: "NOT_FOUND", message: "未知的应用配置条目。", retryable: false };
    });

    await expect(readAppConfigEntry("git-config-home")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "未知的应用配置条目。",
    });
  });

  it("fails closed when the read response is malformed", async () => {
    mockIPC(() => ({ outcome: "content", view: { text: "x" } }));

    await expect(readAppConfigEntry("zed-settings")).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("isAppConfigId", () => {
  it("accepts kebab-case ids up to 64 characters", () => {
    expect(isAppConfigId("git-config-home")).toBe(true);
    expect(isAppConfigId("a".repeat(64))).toBe(true);
    expect(isAppConfigId("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase, separators and path-like text", () => {
    for (const id of ["Git", "git_config", "git--config", "-git", "git-", "a/b", "~"]) {
      expect(isAppConfigId(id), id).toBe(false);
    }
  });
});
