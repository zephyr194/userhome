import { describe, expect, it } from "vitest";
import { localizeErrorMessage } from "../../i18n/errors";
import { translate } from "../../i18n";
import { appConfigDefinitionEn } from "../../i18n/messages/appConfig";
import { APP_TOOLS, describeToolDiscovery } from "./appConfigCatalog";
import {
  appConfigCopy,
  describeProbe,
  formatBytes,
  groupByCategory,
  metaRows,
} from "./appConfigModel";

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const EN = appConfigCopy("en");

const ENTRY_IDS = [
  "git-config-home",
  "git-config-xdg",
  "git-credentials",
  "npmrc",
  "pnpm-auth-ini",
  "zed-settings",
  "ghostty-config",
  "alacritty-config",
  "tmux-conf",
  "tmux-config-xdg",
  "neovim-init",
  "docker-config",
  "ssh-system-config",
];

const FIELD_PATHS = [
  "user.name",
  "user.email",
  "init.defaultBranch",
  "core.editor",
  "core.autocrlf",
  "pull.rebase",
  "push.autoSetupRemote",
  "fetch.prune",
  "commit.gpgsign",
  "color.ui",
  "window.opacity",
  "window.decorations",
  "font.size",
  "font.normal.family",
  "scrolling.history",
  "cursor.style.shape",
];

describe("app config English definitions", () => {
  it("translates every backend entry name and field label and description", () => {
    const keys = [
      ...ENTRY_IDS.map((id) => `entry.${id}`),
      ...FIELD_PATHS.flatMap((path) => [`field.${path}`, `field.${path}.description`]),
    ];
    for (const key of keys) {
      expect(appConfigDefinitionEn[key], key).toBeTruthy();
    }
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  it("keeps Chinese characters out of the English definition table", () => {
    for (const [key, value] of Object.entries(appConfigDefinitionEn)) {
      expect(CJK_PATTERN.test(value), key).toBe(false);
    }
  });

  it("translates every tool summary into English without Chinese", () => {
    for (const tool of APP_TOOLS) {
      expect(translate("zh-CN", tool.summaryKey), tool.id).not.toBe(tool.summaryKey);
      expect(translate("en", tool.summaryKey), tool.id).not.toBe(tool.summaryKey);
      expect(CJK_PATTERN.test(translate("en", tool.summaryKey)), tool.id).toBe(false);
    }
  });
});

describe("app config English labels", () => {
  it("describes probes and tool discovery in English", () => {
    expect(describeProbe({ status: "found", size: 1, modifiedUnixMillis: 1 }, EN).label).toBe("Found");
    expect(describeProbe({ status: "outOfBounds" }, EN).label).toBe("Cannot check");
    expect(describeToolDiscovery("absent", EN).label).toBe("Not found");
  });

  it("groups categories with English labels", () => {
    const groups = groupByCategory(
      [
        { summary: { category: "editor" } as never, probe: { status: "notFound" } },
      ],
      EN,
    );
    expect(groups.map((group) => group.label)).toEqual(["Editor"]);
  });

  it("formats metadata rows with English labels", () => {
    expect(metaRows({ size: 2048, modifiedUnixMillis: 1_700_000_000_000 }, EN)[0]).toEqual([
      "Size",
      "2.0 KB",
    ]);
    expect(formatBytes(512, "en")).toBe("512 B");
  });
});

describe("app config error messages", () => {
  it("maps frontend-generated messages to English", () => {
    const error = { code: "INVALID_INPUT", message: "未知的应用配置条目。" };
    expect(localizeErrorMessage(error, EN.t)).toBe("Unknown app config entry.");
    expect(
      localizeErrorMessage({ code: "INVALID_INPUT", message: "预览已失效，请重新预览。" }, EN.t),
    ).toBe("The preview has expired. Preview the change again.");
    expect(
      localizeErrorMessage({ code: "INVALID_INPUT", message: "没有需要保存的修改。" }, EN.t),
    ).toBe("No changes to save.");
  });

  it("keeps backend messages that have no English mapping in their original text", () => {
    const backend = { code: "INTERNAL", message: "内部错误" };
    expect(localizeErrorMessage(backend, EN.t)).toBe("内部错误");
  });

  it("keeps the original text for zh-CN", () => {
    const error = { code: "INVALID_INPUT", message: "未知的应用配置条目。" };
    expect(localizeErrorMessage(error, appConfigCopy("zh-CN").t)).toBe("未知的应用配置条目。");
  });
});
