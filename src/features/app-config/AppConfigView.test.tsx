/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppConfigListItem, AppConfigReadResult } from "../../ipc/appConfig";
import type { AppError } from "../../ipc/core";
import { AppConfigView } from "./AppConfigView";
import {
  INITIAL_APP_CONFIG_STATE,
  appConfigReducer,
  type AppConfigState,
  type DetailState,
  type ListState,
} from "./appConfigModel";

const noop = () => undefined;

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

const ZED = item("zed-settings", { category: "editor", sensitivity: "sensitiveKeys" }, {
  status: "found",
  size: 120,
  modifiedUnixMillis: 1_700_000_000_000,
});
const CREDENTIALS = item(
  "git-credentials",
  {
    category: "developerTool",
    capability: "discoverOnly",
    sensitivity: "credentials",
    displayPath: "~/.git-credentials",
  },
  { status: "found", size: 64, modifiedUnixMillis: 1_700_000_000_000 },
);
const TMUX = item(
  "tmux-conf",
  { category: "terminal", metadataOnly: true, displayPath: "~/.tmux.conf" },
  { status: "found", size: 300, modifiedUnixMillis: 1_700_000_000_000 },
);
const SSH = item(
  "ssh-system-config",
  { category: "system", displayPath: "/etc/ssh/ssh_config" },
  { status: "found", size: 900, modifiedUnixMillis: 1_700_000_000_000 },
);

function render(list: ListState, detail: DetailState = { status: "idle" }) {
  return renderToStaticMarkup(
    <AppConfigView detail={detail} list={list} onReload={noop} onSelect={noop} />,
  );
}

function readyDetail(
  id: string,
  result: AppConfigReadResult,
  requestId = 1,
): DetailState {
  return { status: "ready", requestId, id, result };
}

describe("AppConfigView states", () => {
  it("announces loading as a status without any list", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain("正在检查默认位置");
    expect(html).not.toContain('role="region"');
  });

  it("says that nothing was found on this machine, with the supported sheet and a refresh action", () => {
    const html = render({ status: "empty" });
    expect(html).toContain("本机没有发现受支持的应用配置。");
    expect(html).toContain("支持的配置");
    expect(html).toContain("刷新");
    expect(html).not.toContain("条目</h2>");
    expect(html).not.toContain("app-config-detail-title");
  });

  it("shows a listing error with a retry action and no entries", () => {
    const error: AppError = { code: "INTERNAL", message: "内部错误", retryable: false };
    const html = render({ status: "error", error });
    expect(html).toContain('role="alert"');
    expect(html).toContain("无法读取应用配置列表");
    expect(html).toContain("重试");
    expect(html).not.toContain("app-config-list-title");
  });

  it("keeps the healthy entries visible when some could not be inspected", () => {
    const failing = item("git-config-home", { category: "developerTool" }, { status: "inaccessible" });
    const html = render({
      status: "partial",
      failedCount: 1,
      items: [ZED, failing],
    });
    expect(html).toContain("有 1 个条目无法检查");
    expect(html).toContain("名称 zed-settings");
    expect(html).toContain("名称 git-config-home");
    expect(html).toContain("无法检查");
  });

  it("does not show a status notice for a fully loaded listing", () => {
    const html = render({ status: "ready", items: [ZED] });
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("states that only default locations are shown and that viewing changes nothing", () => {
    const html = render({ status: "ready", items: [ZED] });
    expect(html).toContain("仅显示默认位置");
    expect(html).toContain("查看不修改任何文件");
  });
});

describe("AppConfigView selection and redaction", () => {
  it("lists entries as keyboard-operable buttons grouped by category", () => {
    const html = render({ status: "ready", items: [ZED, TMUX, SSH] });
    // The supported-configurations action is also a button, so only entry rows are counted.
    expect(html.match(/class="slide-item/g)).toHaveLength(3);
    expect(html).toContain("<h3");
    expect(html).toContain("编辑器");
    expect(html).toContain("终端");
    expect(html).toContain("系统");
  });

  it("pairs each probe badge with a symbol and a text label", () => {
    const html = render({ status: "ready", items: [ZED] });
    expect(html).toContain("✓");
    expect(html).toContain("已发现");
  });

  it("labels the detail region and marks the selected entry as current", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: { text: "theme = \"One\"\n", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="app-config-detail-title"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="解析后的内容"');
    expect(html).toContain("theme = ");
  });

  it("shows masked secrets without ever showing the original value", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: {
          text: '{\n  "apiKey": "[REDACTED]"\n}\n',
          redacted: true,
          withheldLines: 0,
          warnings: [],
        },
      }),
    );
    expect(html).toContain("[REDACTED]");
    expect(html).toContain("敏感值已遮盖");
    expect(html).not.toContain("hunter2");
  });

  it("reports withheld lines and parse warnings beside the content", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: {
          text: "a = 1\n",
          redacted: false,
          withheldLines: 3,
          warnings: [{ line: 7, message: "无法识别的行，内容未显示" }],
        },
      }),
    );
    expect(html).toContain("有 3 行");
    expect(html).toContain("第 7 行：无法识别的行，内容未显示");
  });

  it("gives credentials only a presence note and metadata, never a content view", () => {
    const html = render(
      { status: "ready", items: [CREDENTIALS] },
      readyDetail("git-credentials", {
        outcome: "metadataOnly",
        meta: { size: 64, modifiedUnixMillis: 1_700_000_000_000 },
      }),
    );
    expect(html).toContain("仅确认存在，不读取内容");
    expect(html).toContain("大小");
    expect(html).toContain("修改时间");
    expect(html).not.toContain('aria-label="解析后的内容"');
    expect(html).not.toContain("<pre");
  });

  it("shows metadata-only entries without a content view", () => {
    const html = render(
      { status: "ready", items: [TMUX] },
      readyDetail("tmux-conf", {
        outcome: "metadataOnly",
        meta: { size: 300, modifiedUnixMillis: 1_700_000_000_000 },
      }),
    );
    expect(html).toContain("不读取内容");
    expect(html).not.toContain("<pre");
  });

  it("labels the fixed system SSH file as read-only", () => {
    const html = render(
      { status: "ready", items: [SSH] },
      readyDetail("ssh-system-config", {
        outcome: "content",
        view: { text: "Host *\n", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain("（系统文件）");
    expect(html.slice(html.indexOf('role="region"')).split("只读")).toHaveLength(2);
  });

  it("explains a failed read of one entry without a shared alert for the list", () => {
    const html = render(
      { status: "ready", items: [ZED, TMUX] },
      { status: "failed", requestId: 1, id: "tmux-conf", error: { code: "INTERNAL", message: "内部错误", retryable: false } },
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("无法读取该条目");
    expect(html).toContain("名称 zed-settings");
  });

  it("explains each read failure category", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", { outcome: "failed", kind: "tooLarge" }),
    );
    expect(html).toContain("文件超过读取上限");
  });

  it("shows a loading status while one entry is read", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      { status: "loading", requestId: 1, id: "zed-settings" },
    );
    expect(html).toContain("正在读取");
  });
});

describe("reducer-driven view", () => {
  it("renders the state produced by a selection and a successful read", () => {
    let state: AppConfigState = appConfigReducer(INITIAL_APP_CONFIG_STATE, {
      type: "listLoaded",
      items: [ZED],
    });
    state = appConfigReducer(state, { type: "entrySelected", requestId: 1, id: "zed-settings" });
    state = appConfigReducer(state, {
      type: "entryLoaded",
      requestId: 1,
      id: "zed-settings",
      result: { outcome: "failed", kind: "unreadable" },
    });

    const html = render(state.list, state.detail);
    expect(html).toContain("文件无法读取");
  });
});

describe("AppConfigView flat entry rows (UIF-14)", () => {
  it("does not repeat the refresh action on the list title row", () => {
    const html = render({ status: "ready", items: [ZED, TMUX] });
    expect(html).toMatch(/<h2 id="app-config-list-title"[^>]*>条目<\/h2>/);
    expect(html).not.toContain("刷新");
  });

  it("keeps the refresh action on the empty state, where there is no list", () => {
    const html = render({ status: "empty" });
    expect(html).toMatch(/本机没有发现受支持的应用配置。<\/p>[\s\S]*<button[^>]*>刷新<\/button>/);
  });

  it("renders each entry as a borderless row with the full path in a title attribute", () => {
    const html = render({ status: "ready", items: [ZED] });
    const rows = html.match(/<button[^>]*slide-item[^>]*>/g) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/\bentry-row\b/);
    expect(rows[0]).not.toMatch(/\bborder/);
    expect(html).toContain('title="~/.config/zed-settings.json"');
  });

  it("keeps the read-only label out of every list row", () => {
    const html = render({ status: "ready", items: [ZED, TMUX] });
    const rows = html.match(/<button[^>]*slide-item[^>]*>.*?<\/button>/g) ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toContain("只读");
    expect(html).toContain("仅显示默认位置。查看不修改任何文件，也不检查未登记的文件。");
  });

  it("shows the path once in the detail, in the location row, with the status in the header", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: { text: "a = 1\n", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    const detail = html.slice(html.indexOf('role="region"'));
    expect(detail.split("~/.config/zed-settings.json")).toHaveLength(2);
    expect(detail).toContain("已发现");
  });
});

describe("AppConfigView r4-fe4 fixes", () => {
  it("keeps long code lines scrollable by default and offers a line-wrap toggle", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: { text: "x".repeat(200) + "\n", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain(">换行<");
    expect(html).toContain("overflow-x-auto whitespace-pre");
    expect(html).toContain("r4-fe4-scroll");
  });

  it("keeps the selected row at regular weight, changing only background and the edge bar", () => {
    const css = readFileSync(fileURLToPath(new URL("../../styles/global.css", import.meta.url)), "utf8");
    expect(css).toMatch(
      /\.entry-row:is\(\[aria-current="true"\]\),\s*\.ai-tool-row:is\(\[aria-current="true"\]\)\s*\{\s*font-weight:\s*400;/,
    );
  });
});

describe("AppConfigView 配置内容高亮与窗口展示", () => {
  const ZSHRC = item(
    "zsh-config",
    { category: "terminal", format: "text", displayPath: "~/.zshrc" },
    { status: "found", size: 80, modifiedUnixMillis: 1_700_000_000_000 },
  );

  it("highlights JSON keys and values and offers a window view", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: { text: '{\n  "theme": "dark"\n}\n', redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain('data-token="key"');
    expect(html).toContain('data-token="string"');
    expect(html).toContain("在窗口中查看");
    expect(html).toContain("settings.json");
  });

  it("chooses the shell highlighter for a shell startup file", () => {
    const html = render(
      { status: "ready", items: [ZSHRC] },
      readyDetail("zsh-config", {
        outcome: "content",
        view: { text: "export EDITOR=vim\n", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain('data-token="keyword">export<');
    expect(html).toContain('aria-label="解析后的内容"');
  });

  it("keeps the redaction note on a view that is highlighted", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: {
          text: '{\n  "apiKey": "[REDACTED]"\n}\n',
          redacted: true,
          withheldLines: 2,
          warnings: [],
        },
      }),
    );
    expect(html).toContain("敏感值已遮盖（显示为 [REDACTED]）。");
    expect(html).toContain("[REDACTED]");
    expect(html).toContain("有 2 行");
  });

  it("explains an empty file instead of rendering an empty viewer", () => {
    const html = render(
      { status: "ready", items: [ZED] },
      readyDetail("zed-settings", {
        outcome: "content",
        view: { text: "", redacted: false, withheldLines: 0, warnings: [] },
      }),
    );
    expect(html).toContain("（文件没有可显示的内容）");
    expect(html).not.toContain('aria-label="解析后的内容"');
  });
});

describe("AppConfigView discovered-only list (r8-appcfg)", () => {
  it("places the supported-configurations action in the list title row, before the entries", () => {
    const html = render({ status: "ready", items: [ZED] });
    const action = html.indexOf("支持的配置");
    expect(action).toBeGreaterThan(html.indexOf("app-config-list-title"));
    expect(action).toBeLessThan(html.indexOf("slide-list"));
  });

  it("keeps the action available while the listing is still loading", () => {
    expect(render({ status: "loading" })).toContain("支持的配置");
  });

  it("does not offer a detail panel for an empty listing", () => {
    const html = render({ status: "empty" });
    expect(html).not.toContain("选择左侧条目");
  });
});
