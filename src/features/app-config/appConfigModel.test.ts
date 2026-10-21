import { describe, expect, it } from "vitest";
import type { AppConfigListItem, AppConfigReadResult } from "../../ipc/appConfig";
import type { AppError } from "../../ipc/core";
import {
  INITIAL_APP_CONFIG_STATE,
  appConfigReducer,
  describeEntryDetail,
  describeProbe,
  formatBytes,
  groupByCategory,
  isFixedLocation,
  isKnownEntry,
  type AppConfigState,
} from "./appConfigModel";

const INTERNAL: AppError = { code: "INTERNAL", message: "内部错误", retryable: false };

function item(
  id: string,
  overrides: Partial<AppConfigListItem["summary"]> = {},
  probe: AppConfigListItem["probe"] = { status: "notFound" },
): AppConfigListItem {
  return {
    summary: {
      id,
      name: `名称 ${id}`,
      category: "editor",
      displayPath: `~/.config/${id}.json`,
      format: "json",
      capability: "readOnly",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-16",
      ...overrides,
    },
    probe,
  };
}

function loaded(items: AppConfigListItem[]): AppConfigState {
  return appConfigReducer(INITIAL_APP_CONFIG_STATE, { type: "listLoaded", items });
}

describe("appConfigReducer list state", () => {
  it("starts loading and reports empty when the backend returns no entries", () => {
    expect(INITIAL_APP_CONFIG_STATE.list.status).toBe("loading");
    expect(loaded([]).list.status).toBe("empty");
  });

  it("is ready when every entry could be inspected", () => {
    const state = loaded([item("zed-settings"), item("npmrc", {}, { status: "symlinkOrNonRegular" })]);
    expect(state.list.status).toBe("ready");
  });

  it("is partial when some entries could not be inspected, and keeps the rest", () => {
    const state = loaded([
      item("zed-settings", {}, { status: "found", size: 10, modifiedUnixMillis: 1 }),
      item("git-config-home", {}, { status: "inaccessible" }),
      item("ssh-system-config", { category: "system" }, { status: "outOfBounds" }),
    ]);

    expect(state.list).toMatchObject({ status: "partial", failedCount: 2 });
    expect(state.list.status === "partial" ? state.list.items : []).toHaveLength(3);
  });

  it("records a listing error without touching a selected detail", () => {
    const failed = appConfigReducer(loaded([item("zed-settings")]), {
      type: "listFailed",
      error: INTERNAL,
    });
    expect(failed.list).toEqual({ status: "error", error: INTERNAL });
    expect(failed.detail.status).toBe("idle");
  });

  it("returns to loading when a reload starts", () => {
    const state = appConfigReducer(loaded([item("zed-settings")]), { type: "listRequested" });
    expect(state.list.status).toBe("loading");
  });
});

describe("appConfigReducer entry selection", () => {
  const base = loaded([item("zed-settings"), item("npmrc")]);

  it("ignores an id that the current listing does not contain", () => {
    const next = appConfigReducer(base, {
      type: "entrySelected",
      requestId: 1,
      id: "not-in-list",
    });
    expect(next).toBe(base);
  });

  it("ignores ids that are not kebab-case even when they are listed", () => {
    const withBadId = loaded([item("Zed_Settings")]);
    expect(isKnownEntry(withBadId, "Zed_Settings")).toBe(false);
  });

  it("applies the response of the current request only", () => {
    const selecting = appConfigReducer(base, { type: "entrySelected", requestId: 2, id: "zed-settings" });
    const stale = appConfigReducer(selecting, {
      type: "entryLoaded",
      requestId: 1,
      id: "zed-settings",
      result: { outcome: "failed", kind: "tooLarge" },
    });
    expect(stale.detail.status).toBe("loading");

    const current = appConfigReducer(selecting, {
      type: "entryLoaded",
      requestId: 2,
      id: "zed-settings",
      result: { outcome: "failed", kind: "parseError" },
    });
    expect(current.detail).toMatchObject({ status: "ready", id: "zed-settings" });
  });

  it("keeps a failed read local to the selected entry", () => {
    const selecting = appConfigReducer(base, { type: "entrySelected", requestId: 1, id: "npmrc" });
    const failed = appConfigReducer(selecting, {
      type: "entryFailed",
      requestId: 1,
      id: "npmrc",
      error: INTERNAL,
    });
    expect(failed.detail).toMatchObject({ status: "failed", error: INTERNAL });
    expect(failed.list).toEqual(base.list);
  });

  it("drops the selection when a reload no longer lists the entry", () => {
    const selected = appConfigReducer(base, { type: "entrySelected", requestId: 1, id: "npmrc" });
    const reloaded = appConfigReducer(selected, {
      type: "listLoaded",
      items: [item("zed-settings")],
    });
    expect(reloaded.detail.status).toBe("idle");
  });
});

describe("groupByCategory", () => {
  it("orders categories for display and keeps registry order inside each", () => {
    const groups = groupByCategory([
      item("ssh-system-config", { category: "system" }),
      item("zed-settings", { category: "editor" }),
      item("claude-code-settings", { category: "aiClient" }),
      item("neovim-init", { category: "editor" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["编辑器", "AI 客户端", "系统"]);
    expect(groups[0]?.items.map((entry) => entry.summary.id)).toEqual(["zed-settings", "neovim-init"]);
  });

  it("omits categories without entries", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("describeProbe", () => {
  it("pairs every probe status with text and a symbol, not colour alone", () => {
    expect(describeProbe({ status: "found", size: 1, modifiedUnixMillis: 1 })).toEqual({
      symbol: "✓",
      label: "已发现",
      tone: "success",
    });
    expect(describeProbe({ status: "notFound" }).label).toBe("未发现");
    expect(describeProbe({ status: "symlinkOrNonRegular" }).label).toBe("符号链接或非常规文件");
    expect(describeProbe({ status: "inaccessible" }).label).toBe("不可访问");
    expect(describeProbe({ status: "outOfBounds" }).label).toBe("越界");
    for (const probe of [
      { status: "notFound" as const },
      { status: "inaccessible" as const },
      { status: "outOfBounds" as const },
    ]) {
      expect(describeProbe(probe).symbol).not.toBe("");
    }
  });
});

describe("describeEntryDetail", () => {
  const plain = item("zed-settings").summary;

  it("shows masked content with its warnings and withheld count", () => {
    const result: AppConfigReadResult = {
      outcome: "content",
      view: {
        text: "{\n  \"apiKey\": \"[REDACTED]\"\n}\n",
        redacted: true,
        withheldLines: 2,
        warnings: [{ line: 5, message: "无法识别的行，内容未显示" }],
      },
    };
    const view = describeEntryDetail(plain, result);
    expect(view).toMatchObject({
      kind: "content",
      redacted: true,
      withheldLines: 2,
      warnings: [{ line: 5 }],
    });
    expect(view.kind === "content" && view.text).toContain("[REDACTED]");
  });

  it("explains that credentials are only detected, never read", () => {
    const credentials = item("git-credentials", {
      category: "developerTool",
      capability: "discoverOnly",
      sensitivity: "credentials",
    }).summary;
    const view = describeEntryDetail(credentials, {
      outcome: "metadataOnly",
      meta: { size: 2048, modifiedUnixMillis: 1_700_000_000_000 },
    });
    expect(view).toMatchObject({ kind: "metadata" });
    expect(view.kind === "metadata" && view.note).toContain("不读取内容");
    expect(view.kind === "metadata" && view.rows.map(([label]) => label)).toEqual(["大小", "修改时间"]);
  });

  it("gives metadata-only entries no content view", () => {
    const tmux = item("tmux-conf", { metadataOnly: true, sensitivity: "none" }).summary;
    const view = describeEntryDetail(tmux, {
      outcome: "metadataOnly",
      meta: { size: 10, modifiedUnixMillis: 1 },
    });
    expect(view.kind).toBe("metadata");
  });

  it("notes that plist and dotenv formats are not parsed yet", () => {
    const plist = item("plist-entry", { format: "plist" }).summary;
    const view = describeEntryDetail(plist, {
      outcome: "metadataOnly",
      meta: { size: 10, modifiedUnixMillis: 1 },
    });
    expect(view.kind === "metadata" && view.note).toContain("暂不解析");
  });

  it("describes each unavailable status and each read failure", () => {
    const messages = (["notFound", "symlinkOrNonRegular", "inaccessible", "outOfBounds"] as const).map(
      (status) => describeEntryDetail(plain, { outcome: "unavailable", status: { status } }),
    );
    expect(messages.every((view) => view.kind === "unavailable")).toBe(true);

    for (const kind of ["tooLarge", "parseError", "unreadable"] as const) {
      const view = describeEntryDetail(plain, { outcome: "failed", kind });
      expect(view).toMatchObject({ kind: "failed" });
    }
  });
});

describe("display helpers", () => {
  it("marks fixed locations outside the home directory", () => {
    expect(isFixedLocation(item("ssh-system-config", { displayPath: "/etc/ssh/ssh_config" }).summary)).toBe(true);
    expect(isFixedLocation(item("zed-settings").summary)).toBe(false);
  });

  it("formats sizes in bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
