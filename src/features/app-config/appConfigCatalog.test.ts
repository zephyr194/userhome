/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import type { AppConfigListItem, AppConfigProbeStatus } from "../../ipc/appConfig";
import {
  APP_TOOLS,
  APP_TOOL_ICON_KEYS,
  describeToolDiscovery,
  toolDiscovery,
  toolsForSupported,
  type AppTool,
} from "./appConfigCatalog";

interface RegistryEntry {
  id: string;
  category: string;
}

function registryEntries(): RegistryEntry[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../../src-tauri/src/app_config/registry.rs", import.meta.url)),
    "utf8",
  );
  const start = source.indexOf("pub const BUILTIN_ENTRIES");
  const end = source.indexOf("\n];", start);
  return source
    .slice(start, end)
    .split("    Entry {")
    .slice(1)
    .map((block) => {
      const id = /id: "([^"]+)"/.exec(block)?.[1];
      const category = /category: Category::(\w+)/.exec(block)?.[1];
      if (id === undefined || category === undefined) {
        throw new Error("registry entry without id or category");
      }
      return { id, category };
    });
}

const NON_AI_IDS = registryEntries()
  .filter((entry) => entry.category !== "AiClient")
  .map((entry) => entry.id);

function item(id: string, probe: AppConfigProbeStatus): AppConfigListItem {
  return {
    summary: {
      id,
      name: id,
      category: "editor",
      displayPath: `~/${id}`,
      format: "json",
      capability: "readOnly",
      sensitivity: "none",
      metadataOnly: false,
      sourceUrl: "https://example.com/doc",
      verifiedOn: "2026-10-23",
    },
    probe,
  };
}

const FOUND: AppConfigProbeStatus = { status: "found", size: 1, modifiedUnixMillis: 1 };

function toolNamed(name: string): AppTool {
  const tool = APP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

function zhSummary(tool: AppTool): string {
  return translate("zh-CN", tool.summaryKey);
}

describe("白名单工具目录与注册表一致", () => {
  it("注册表里每个非 AI 条目都恰好被一个工具覆盖", () => {
    for (const id of NON_AI_IDS) {
      const owners = APP_TOOLS.filter((tool) => tool.entryIds.includes(id));
      expect(owners.map((tool) => tool.name), id).toHaveLength(1);
    }
  });

  it("工具目录没有孤儿 id：每个映射的 id 都是注册表中的非 AI 条目", () => {
    const known = new Set(NON_AI_IDS);
    for (const tool of APP_TOOLS) {
      for (const id of tool.entryIds) {
        expect(known.has(id), `${tool.name} → ${id}`).toBe(true);
      }
    }
  });

  it("没有 AI 工具出现在目录里", () => {
    const aiIds = registryEntries()
      .filter((entry) => entry.category === "AiClient")
      .map((entry) => entry.id);
    for (const tool of APP_TOOLS) {
      for (const id of aiIds) expect(tool.entryIds).not.toContain(id);
    }
  });

  it("工具 id 与展示名称各自唯一", () => {
    expect(new Set(APP_TOOLS.map((tool) => tool.id)).size).toBe(APP_TOOLS.length);
    expect(new Set(APP_TOOLS.map((tool) => tool.name)).size).toBe(APP_TOOLS.length);
  });
});

describe("白名单工具目录内容", () => {
  it("Git 把全局配置、XDG 位置与凭据库合并为一行", () => {
    expect([...toolNamed("Git").entryIds].sort()).toEqual(
      ["git-config-home", "git-config-xdg", "git-credentials"].sort(),
    );
  });

  it("tmux 把两个配置位置合并为一行", () => {
    expect([...toolNamed("tmux").entryIds].sort()).toEqual(["tmux-conf", "tmux-config-xdg"].sort());
  });

  it("每个工具有一句话作用说明，且只占一行", () => {
    for (const tool of APP_TOOLS) {
      const summary = zhSummary(tool);
      expect(summary.trim(), tool.name).not.toBe("");
      expect(summary, tool.name).not.toContain("\n");
      expect(summary.endsWith("。"), tool.name).toBe(true);
    }
  });

  it("Git 的作用说明与设计稿一致", () => {
    expect(zhSummary(toolNamed("Git"))).toBe("全局身份、默认分支与行为设置。");
  });

  it("每个图标键都在允许的线条图标集合里，同一工具只有一个图标", () => {
    for (const tool of APP_TOOLS) {
      expect(APP_TOOL_ICON_KEYS).toContain(tool.icon);
    }
    expect(toolNamed("npm").icon).toBe(toolNamed("pnpm").icon);
  });
});

describe("toolsForSupported", () => {
  it("只保留后端返回的条目所属的工具，并保持目录顺序", () => {
    const supported = [
      { id: "tmux-conf", name: "tmux 配置", category: "terminal" as const, format: "text" as const, capability: "readOnly" as const },
      { id: "git-credentials", name: "Git 明文凭据库", category: "developerTool" as const, format: "text" as const, capability: "discoverOnly" as const },
    ];

    expect(toolsForSupported(supported).map((tool) => tool.name)).toEqual(["Git", "tmux"]);
  });
});

describe("toolDiscovery", () => {
  const git = toolNamed("Git");

  it("未读取列表时不给出结论", () => {
    expect(toolDiscovery(git, undefined)).toBe("unchecked");
  });

  it("任一位置已发现即为已发现，即使其他位置未发现", () => {
    expect(toolDiscovery(git, [item("git-config-home", FOUND)])).toBe("discovered");
  });

  it("已发现的符号链接或非常规文件也算存在", () => {
    expect(
      toolDiscovery(toolNamed("tmux"), [item("tmux-conf", { status: "symlinkOrNonRegular" })]),
    ).toBe("discovered");
  });

  it("只有无法检查的位置时标为无法检查，而不是未发现", () => {
    expect(toolDiscovery(git, [item("git-credentials", { status: "inaccessible" })])).toBe("unverified");
    expect(toolDiscovery(git, [item("git-config-xdg", { status: "outOfBounds" })])).toBe("unverified");
  });

  it("列表中没有任何位置时为未发现", () => {
    expect(toolDiscovery(git, [item("zed-settings", FOUND)])).toBe("absent");
    expect(toolDiscovery(git, [])).toBe("absent");
  });
});

describe("describeToolDiscovery", () => {
  it("每个状态都有符号与文字，不只靠颜色", () => {
    expect(describeToolDiscovery("discovered").label).toBe("已发现");
    expect(describeToolDiscovery("absent").label).toBe("未发现");
    expect(describeToolDiscovery("unverified").label).toBe("无法检查");
    expect(describeToolDiscovery("unchecked").label).toBe("未检查");
    for (const state of ["discovered", "absent", "unverified", "unchecked"] as const) {
      expect(describeToolDiscovery(state).symbol).not.toBe("");
    }
  });
});
