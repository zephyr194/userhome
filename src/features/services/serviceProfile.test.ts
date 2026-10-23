import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import { zhCN } from "../../i18n/messages/zh-CN";
import { en } from "../../i18n/messages/en";
import { CREATED_LABEL, CREATED_OWNERSHIP, configFile, launchdService, APPLE_OWNERSHIP, DAEMON_OWNERSHIP } from "./launchdFixtures";
import type { LaunchdPlistDetails } from "../../ipc/services";
import { SERVICE_DICTIONARY } from "./serviceDictionary";
import {
  displayNameOf,
  groupServices,
  injectorOf,
  programFileName,
  purposeOf,
  triggerOf,
} from "./serviceProfile";

const zh = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("zh-CN", key, params);
const english = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("en", key, params);

const plistWith = (details: Partial<LaunchdPlistDetails>) =>
  configFile({
    details: { programArguments: [], argumentsTruncated: false, environmentKeys: [], ...details },
  });

const triggerWith = (
  details: Partial<LaunchdPlistDetails>,
  overrides: Parameters<typeof launchdService>[0] = {},
) => triggerOf(launchdService({ configFiles: [plistWith(details)], ...overrides }), zh);

describe("triggerOf", () => {
  it.each<[string, Partial<LaunchdPlistDetails>, string, string]>([

    ["常驻", { keepAlive: { mode: "ALWAYS", conditions: [] } }, "常驻", "常驻，退出后自动重启。"],
    [
      "条件保持运行",
      { keepAlive: { mode: "CONDITIONAL", conditions: ["SuccessfulExit"] } },
      "条件保持运行",
      "满足条件时保持运行。",
    ],
    ["间隔", { startInterval: 900 }, "定时", "每 15 分钟运行。"],
    ["按需", { watchPathsCount: 1 }, "按需", "有事件时按需启动。"],
    ["套接字按需", { socketNames: ["http"] }, "按需", "有事件时按需启动。"],
    ["挂载", { startOnMount: true }, "挂载时启动", "挂载磁盘时启动。"],
    ["KeepAlive 为 NEVER 视为手动", { keepAlive: { mode: "NEVER", conditions: [] } }, "手动", "手动启动。"],
    ["没有任何启动字段视为手动", {}, "手动", "手动启动。"],
  ])("%s", (_name, details, badge, sentence) => {
    const trigger = triggerWith(details);
    expect(trigger.badge).toBe(badge);
    expect(trigger.sentence).toBe(sentence);
  });

  it("uses the boot wording for system-domain jobs", () => {
    const trigger = triggerOf(
      launchdService({ domain: "SYSTEM", configFiles: [plistWith({ runAtLoad: true })] }),
      zh,
    );
    expect(trigger.badge).toBe("开机时启动");
    expect(trigger.sentence).toBe("开机时启动。");
  });

  it("joins several triggers in the sentence and shows the first two badges with an ellipsis", () => {
    const trigger = triggerWith({
      runAtLoad: true,
      keepAlive: { mode: "ALWAYS", conditions: [] },
      startInterval: 900,
    });
    expect(trigger.kinds).toEqual(["LOGIN", "KEEP_ALIVE", "INTERVAL"]);
    expect(trigger.badge).toBe("登录时启动 · 常驻…");
    expect(trigger.sentence).toBe("登录时启动，常驻，退出后自动重启，每 15 分钟运行。");
  });

  it("shows a single scheduled badge when interval and calendar both apply", () => {
    const trigger = triggerWith({
      startInterval: 60,
      startCalendar: [{ hour: 3, minute: 0 }],
    });
    expect(trigger.badge).toBe("定时");
    expect(trigger.sentence).toBe("每 1 分钟运行，每天 03:00。");
  });

  it("appends disabled to the sentence and the badge", () => {
    const trigger = triggerWith({ runAtLoad: true, disabled: true });
    expect(trigger.badge).toBe("登录时启动 · 已禁用");
    expect(trigger.sentence).toBe("登录时启动，已禁用。");
  });

  it("says manual start before disabled when nothing else starts the job", () => {
    const trigger = triggerWith({ disabled: true });
    expect(trigger.kinds).toEqual(["MANUAL", "DISABLED"]);
    expect(trigger.badge).toBe("手动 · 已禁用");
    expect(trigger.sentence).toBe("手动启动，已禁用。");
  });

  it.each([
    [1, "每 1 秒运行"],
    [90, "每 90 秒运行"],
    [300, "每 5 分钟运行"],
    [5400, "每 90 分钟运行"],
    [7200, "每 2 小时运行"],
  ])("converts %i seconds into the largest whole unit", (seconds, sentence) => {
    expect(triggerWith({ startInterval: seconds }).sentence).toBe(`${sentence}。`);
  });

  it.each([
    [[{ hour: 3, minute: 0 }], "每天 03:00"],
    [[{ weekday: 1, hour: 9, minute: 0 }], "每周一 09:00"],
    [[{ weekday: 0, hour: 8, minute: 5 }], "每周日 08:05"],
    [[{ weekday: 7, hour: 8, minute: 5 }], "每周日 08:05"],
    [[{ day: 1, hour: 0, minute: 0 }], "每月 1 日 00:00"],
    [
      [
        { hour: 3, minute: 0 },
        { weekday: 1, hour: 9, minute: 0 },
      ],
      "每天 03:00、每周一 09:00",
    ],
  ])("describes calendar slots %#", (startCalendar, phrase) => {
    expect(triggerWith({ startCalendar }).sentence).toBe(`${phrase}。`);
  });

  it("counts calendar slots beyond three instead of listing them", () => {
    const slots = [1, 2, 3, 4].map((hour) => ({ hour, minute: 0 }));
    expect(triggerWith({ startCalendar: slots }).sentence).toBe("按日历定时（共 4 条）。");
  });

  it("falls back to a plain calendar phrase when a slot cannot be expressed", () => {
    expect(triggerWith({ startCalendar: [{ minute: 0 }] }).sentence).toBe("按日历定时。");
    expect(triggerWith({ startCalendar: [{ hour: 3, minute: 0, month: 6 }] }).sentence).toBe(
      "按日历定时。",
    );
    expect(
      triggerWith({ startCalendar: [{ day: 1, weekday: 1, hour: 0, minute: 0 }] }).sentence,
    ).toBe("按日历定时。");
    const slots = [
      { hour: 3, minute: 0 },
      { minute: 0 },
      { hour: 4, minute: 0 },
      { hour: 5, minute: 0 },
    ];
    expect(triggerWith({ startCalendar: slots }).sentence).toBe("按日历定时。");
  });

  it("marks a truncated calendar as having more entries", () => {
    const slots = Array.from({ length: 24 }, (_, hour) => ({ hour, minute: 0 }));
    expect(triggerWith({ startCalendar: slots, startCalendarTruncated: true }).sentence).toBe(
      "按日历定时（共 24 条以上）。",
    );
  });

  it("keeps the RunAtLoad and KeepAlive reading for backends without the scheduling fields", () => {
    const trigger = triggerWith({
      runAtLoad: true,
      keepAlive: { mode: "ALWAYS", conditions: [] },
    });
    expect(trigger.badge).toBe("登录时启动 · 常驻");
    expect(trigger.sentence).toBe("登录时启动，常驻，退出后自动重启。");
  });

  it("reports an unknown start timing when no plist details were read", () => {
    const trigger = triggerOf(launchdService({ configFiles: [] }), zh);
    expect(trigger.kinds).toEqual(["UNKNOWN"]);
    expect(trigger.badge).toBe("未知");
    expect(trigger.sentence).toBe("启动时机未知。");
    expect(
      triggerOf(launchdService({ configFiles: [configFile({ details: undefined })] }), zh).badge,
    ).toBe("未知");
  });

  it("reads the plist details from the first config file that has them", () => {
    const trigger = triggerOf(
      launchdService({
        configFiles: [configFile({ details: undefined }), plistWith({ startOnMount: true })],
      }),
      zh,
    );
    expect(trigger.sentence).toBe("挂载磁盘时启动。");
  });

  it("writes the English wording with the same structure", () => {
    const trigger = triggerOf(
      launchdService({ configFiles: [plistWith({ runAtLoad: true, startInterval: 900 })] }),
      english,
    );
    expect(trigger.badge).toBe("Starts at login · Scheduled");
    expect(trigger.sentence).toBe("Starts at login, every 15 minutes.");
    expect(
      triggerOf(launchdService({ configFiles: [plistWith({ disabled: true })] }), english).sentence,
    ).toBe("Manual start, disabled.");
  });
});

const userFile = (program: string | undefined, overrides = {}) =>
  configFile({
    details: {
      ...(program === undefined ? {} : { program }),
      programArguments: program === undefined ? [] : [program],
      argumentsTruncated: false,
      environmentKeys: [],
    },
    ...overrides,
  });

describe("injectorOf", () => {
  it("puts UserHome-created and adopted jobs in the UserHome group", () => {
    expect(
      injectorOf(launchdService({ label: CREATED_LABEL, ownership: CREATED_OWNERSHIP })),
    ).toBe("USERHOME");
    expect(
      injectorOf(
        launchdService({
          label: "com.zephyr194.userhome.agent.caddy",
          ownership: { ...CREATED_OWNERSHIP, kind: "USERHOME_ADOPTED" },
        }),
      ),
    ).toBe("USERHOME");
  });

  it("puts Homebrew formula jobs in the Homebrew group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "homebrew.mxcl.postgresql@16",
          configFiles: [userFile("/opt/homebrew/opt/postgresql@16/bin/postgres")],
        }),
      ),
    ).toBe("HOMEBREW");
  });

  it("puts jobs whose program lives in an app bundle in the app group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "com.example.caddyd",
          configFiles: [userFile("/Applications/Caddy.app/Contents/MacOS/caddyd")],
        }),
      ),
    ).toBe("APP");
    expect(
      injectorOf(
        launchdService({
          label: "com.example.helper",
          configFiles: [userFile("~/Applications/Helper.app/Contents/MacOS/helper")],
        }),
      ),
    ).toBe("APP");
  });

  it("puts a global agent whose program sits in an app bundle in the app group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "com.example.updater",
          scope: "GLOBAL_AGENT",
          ownership: { ...CREATED_OWNERSHIP, kind: "GLOBAL_AGENT", modifiable: false, readOnlyReasons: ["GLOBAL_AGENT_LOCATION"] },
          configFiles: [
            configFile({
              path: "/Library/LaunchAgents/com.example.updater.plist",
              directory: "GLOBAL_LAUNCH_AGENTS",
              scope: "GLOBAL_AGENT",
              details: {
                program: "/Library/Application Support/Updater/Updater.app/Contents/MacOS/updater",
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
              },
            }),
          ],
        }),
      ),
    ).toBe("APP");
  });

  it("puts the current user's own agents in the user group", () => {
    expect(injectorOf(launchdService())).toBe("USER");
    expect(
      injectorOf(
        launchdService({
          label: "com.example.worker",
          configFiles: [userFile("/usr/local/bin/worker")],
        }),
      ),
    ).toBe("USER");
  });

  it("puts a job it cannot place in the third-party group", () => {
    expect(injectorOf(launchdService({ configFiles: [] }))).toBe("THIRD_PARTY");
    expect(
      injectorOf(
        launchdService({
          label: "com.vendor.agent",
          configFiles: [
            configFile({
              path: "/Library/LaunchAgents/com.vendor.agent.plist",
              directory: "GLOBAL_LAUNCH_AGENTS",
              scope: "GLOBAL_AGENT",
              details: {
                program: "/Library/Vendor/agent",
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
              },
            }),
          ],
        }),
      ),
    ).toBe("THIRD_PARTY");
  });

  it("puts system jobs and com.apple. labels in the system group", () => {
    expect(
      injectorOf(
        launchdService({ domain: "SYSTEM", scope: "SYSTEM_DAEMON", ownership: DAEMON_OWNERSHIP }),
      ),
    ).toBe("SYSTEM");
    expect(
      injectorOf(
        launchdService({
          label: "com.apple.metadata.mds",
          domain: "SYSTEM",
          ownership: APPLE_OWNERSHIP,
        }),
      ),
    ).toBe("SYSTEM");
  });

  it("does not let a com.apple. label in a user folder count as a user job", () => {
    expect(
      injectorOf(launchdService({ label: "com.apple.something", ownership: APPLE_OWNERSHIP })),
    ).toBe("SYSTEM");
  });
});

describe("displayNameOf", () => {
  it("uses the formula name for Homebrew jobs", () => {
    expect(displayNameOf(launchdService({ label: "homebrew.mxcl.postgresql@16" }))).toBe(
      "postgresql@16",
    );
  });

  it("uses the task name for UserHome jobs", () => {
    expect(displayNameOf(launchdService({ label: CREATED_LABEL, ownership: CREATED_OWNERSHIP }))).toBe(
      "agent.demo",
    );
  });

  it("uses the app name for app-installed jobs", () => {
    expect(
      displayNameOf(
        launchdService({
          label: "com.example.caddyd",
          configFiles: [userFile("/Applications/Caddy.app/Contents/MacOS/caddyd")],
        }),
      ),
    ).toBe("Caddy");
  });

  it("drops common reverse-domain prefixes and keeps the last two segments", () => {
    expect(displayNameOf(launchdService({ label: "com.example.agent" }))).toBe("example.agent");
    expect(displayNameOf(launchdService({ label: "com.vendor.daemon" }))).toBe("vendor.daemon");
  });

  it("keeps a short label whole", () => {
    expect(displayNameOf(launchdService({ label: "broken", configFiles: [] }))).toBe("broken");
  });
});

describe("programFileName", () => {
  it("returns the program's file name without its directory", () => {
    expect(programFileName(launchdService({ configFiles: [userFile("/usr/local/bin/example")] }))).toBe(
      "example",
    );
  });

  it("is undefined when no program path was read", () => {
    expect(programFileName(launchdService({ configFiles: [] }))).toBeUndefined();
  });
});

describe("purposeOf", () => {
  it("describes a dictionary match from the label", () => {
    expect(
      purposeOf(
        launchdService({
          label: "homebrew.mxcl.postgresql@16",
          configFiles: [userFile("/opt/homebrew/opt/postgresql@16/bin/postgres")],
        }),
        zh,
      ),
    ).toBe("关系型数据库");
  });

  it("describes a dictionary match from the program file name", () => {
    expect(
      purposeOf(
        launchdService({
          label: "com.example.agent",
          configFiles: [userFile("/opt/homebrew/bin/redis-server")],
        }),
        zh,
      ),
    ).toBe("内存键值存储");
  });

  it("does not match a key inside a longer word", () => {
    expect(
      purposeOf(
        launchdService({ label: "com.example.redisish", configFiles: [userFile("/usr/local/bin/x")] }),
        zh,
      ),
    ).toBeNull();
  });

  it("falls back to the formula name for Homebrew jobs outside the dictionary", () => {
    expect(
      purposeOf(
        launchdService({ label: "homebrew.mxcl.somekit", configFiles: [userFile("/opt/homebrew/bin/somekit")] }),
        zh,
      ),
    ).toBe("Homebrew 安装的 somekit");
  });

  it("falls back to the app name for app-installed jobs outside the dictionary", () => {
    expect(
      purposeOf(
        launchdService({
          label: "com.example.worker",
          configFiles: [userFile("/Applications/Acme.app/Contents/MacOS/worker")],
        }),
        zh,
      ),
    ).toBe("Acme 的后台组件");
  });

  it("returns null rather than inventing a purpose", () => {
    expect(
      purposeOf(launchdService({ label: "com.example.agent", configFiles: [userFile("/usr/local/bin/example")] }), zh),
    ).toBeNull();
    expect(purposeOf(launchdService({ label: "com.example.agent", configFiles: [] }), zh)).toBeNull();
  });

  it("translates the fallback text into English", () => {
    const text = purposeOf(
      launchdService({ label: "homebrew.mxcl.somekit", configFiles: [] }),
      (key, params) => translate("en", key, params),
    );
    expect(text).toBe("Installed by Homebrew: somekit");
  });
});

describe("groupServices", () => {
  it("lists groups in the fixed order and skips empty ones", () => {
    const groups = groupServices([
      launchdService({ id: "system/com.apple.x", label: "com.apple.x", domain: "SYSTEM", ownership: APPLE_OWNERSHIP }),
      launchdService({ id: "a", label: "com.example.agent" }),
      launchdService({ id: "b", label: "homebrew.mxcl.redis", configFiles: [] }),
      launchdService({ id: "c", label: CREATED_LABEL, ownership: CREATED_OWNERSHIP }),
    ]);
    expect(groups.map((group) => group.injector)).toEqual([
      "USERHOME",
      "HOMEBREW",
      "USER",
      "SYSTEM",
    ]);
    expect(groups.map((group) => group.services.length)).toEqual([1, 1, 1, 1]);
  });

  it("keeps the services of a group in their input order", () => {
    const [group] = groupServices([
      launchdService({ id: "1", label: "com.example.one" }),
      launchdService({ id: "2", label: "com.example.two" }),
    ]);
    expect(group.services.map((service) => service.id)).toEqual(["1", "2"]);
  });

  it("returns no groups for no services", () => {
    expect(groupServices([])).toEqual([]);
  });
});

describe("service dictionary", () => {
  it("has unique, lowercase keys", () => {
    const keys = SERVICE_DICTIONARY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key, key).toBe(key.toLowerCase());
      expect(key.trim(), key).not.toBe("");
    }
  });

  it("points only at purposes that have a non-empty zh-CN and en text", () => {
    for (const entry of SERVICE_DICTIONARY) {
      expect(zhCN[entry.purpose].trim(), entry.key).not.toBe("");
      expect(en[entry.purpose].trim(), entry.key).not.toBe("");
    }
  });

  it("names the common development services", () => {
    const keys = new Set(SERVICE_DICTIONARY.map((entry) => entry.key));
    for (const key of ["postgres", "mysql", "redis", "nginx", "caddy", "docker", "ollama", "php-fpm"]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
